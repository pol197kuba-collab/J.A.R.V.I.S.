// MARKET GRID — pobieranie newsów i ocena ich wpływu przez model.
//
// Plik serwerowy: klucze API nigdy nie mogą trafić do bundla klienta, a
// kanały RSS nie wystawiają CORS-a.
//
// WYBÓR MODELU. Ocena wpływu newsu to zadanie rozumujące — trzeba połączyć
// nagłówek z instrumentem i ocenić kierunek — więc gdy użytkownik ma klucz
// Anthropic, idzie ona na Claude; bez niego na Gemini; bez obu na
// heurystykę słownikową. Obie ścieżki AI przechodzą przez te same adaptery
// co rozmowy agentów, żeby nie powstała trzecia kopia wywołania modelu.
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { callAnthropic } from "@/lib/agents/providers/anthropic";
import type { GeminiContent } from "@/lib/agents/providers/types";
import { dedupeNews, parseRss, type RssItem } from "@/lib/rss/parse";
import type { MarketAsset } from "./assets";
import {
  MARKET_FEEDS,
  heuristicVerdict,
  type MarketImpact,
  type MarketNewsItem,
  type MarketVerdict,
} from "./news";

const FETCH_TIMEOUT_MS = 15_000;
const MODEL_TIMEOUT_MS = 40_000;
const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Model Claude użyty do oceny newsów, gdy klucz Anthropic jest dostępny. */
const ANTHROPIC_NEWS_MODEL = "claude-sonnet-5";

// Ile nagłówków idzie do modelu w jednym wywołaniu. Jedno wywołanie na całą
// paczkę, nie jedno na news: kilkadziesiąt osobnych żądań to kilkadziesiąt
// okazji do rate-limitu, a model i tak ocenia każdy tytuł niezależnie.
const CLASSIFY_BATCH = 40;

function systemPrompt(assets: readonly MarketAsset[]): string {
  const catalog = assets.map((a) => `${a.symbol} = ${a.label}`).join("; ");
  return `Jesteś analitykiem rynkowym. Dla każdego nagłówka prasowego oceniasz, czego dotyczy i w którą stronę może pchnąć cenę.

Obserwowane instrumenty (symbol = nazwa): ${catalog}

Dla każdego nagłówka zwróć obiekt:
- symbols: tablica symboli Z POWYŻSZEJ LISTY, których news realnie dotyczy. Pusta tablica, gdy to news ogólnorynkowy albo niezwiązany — NIE dopisuj instrumentów "na wszelki wypadek".
- impact: "bullish" gdy news sprzyja WZROSTOWI ceny wskazanych instrumentów, "bearish" gdy sprzyja SPADKOWI, "neutral" gdy kierunek jest żaden lub niejasny. Kierunek dotyczy WSKAZANYCH INSTRUMENTÓW, nie nastroju rynku ogólnie — ten sam news bywa bullish dla złota i bearish dla akcji. Gdy dla jednych instrumentów byłby bullish, a dla innych bearish, wybierz te, dla których sygnał jest wyraźniejszy, i zostaw tylko je.
- score: 0-100, jak mocno ten news może ruszyć ceną. Ciekawostka albo zapowiedź walnego zgromadzenia to 10-25, wyniki kwartalne dużej spółki 50-70, decyzja Fed lub sankcje na dużego eksportera 75-95.
- summary_pl: JEDNO zdanie po polsku (maks. 160 znaków) mówiące, co to oznacza dla ceny. Bez powtarzania tytułu.

Nie zgaduj kierunku na siłę — "neutral" jest poprawną odpowiedzią i lepszą niż zmyślony sygnał. Odpowiedz WYŁĄCZNIE tablicą JSON, w tej samej kolejności co wejście, bez komentarza.`;
}

const userPrompt = (titles: string[]): string => titles.map((t, i) => `${i + 1}. ${t}`).join("\n");

function extractJsonArray(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

type RawVerdict = { symbols?: unknown; impact?: unknown; score?: unknown; summary_pl?: unknown };

/**
 * Normalizuje jeden werdykt modelu. Każda nieścisłość degraduje się do
 * heurystyki dla tego konkretnego nagłówka, a nie wywraca całej paczki.
 */
export function normalizeVerdict(
  raw: unknown,
  title: string,
  assets: readonly MarketAsset[],
): MarketVerdict {
  if (typeof raw !== "object" || raw === null) return heuristicVerdict(title, assets);
  const row = raw as RawVerdict;

  const impact: MarketImpact | null =
    row.impact === "bullish" || row.impact === "bearish" || row.impact === "neutral"
      ? row.impact
      : null;
  if (!impact) return heuristicVerdict(title, assets);

  // Model potrafi wymyślić symbol spoza katalogu (albo zwrócić nazwę
  // zamiast symbolu) — przepuszczamy tylko te, które faktycznie istnieją,
  // bo na nich opiera się filtrowanie i agregacja.
  const known = new Set(assets.map((a) => a.symbol));
  const symbols = Array.isArray(row.symbols)
    ? [
        ...new Set(
          row.symbols.map((s) => String(s).trim().toUpperCase()).filter((s) => known.has(s)),
        ),
      ]
    : [];

  const scoreRaw = typeof row.score === "number" ? row.score : Number(row.score);
  const impactScore = Number.isFinite(scoreRaw)
    ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
    : 50;

  const summaryPl =
    typeof row.summary_pl === "string" && row.summary_pl.trim()
      ? row.summary_pl.trim().slice(0, 240)
      : null;

  return { symbols, impact, impactScore, summaryPl, classifiedBy: "ai" };
}

async function callGeminiForNews(
  apiKey: string,
  system: string,
  user: string,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GEMINI_ENDPOINT_BASE}/${DEFAULT_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() || null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type NewsClassifierKeys = {
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
};

/**
 * Zwraca werdykt dla każdego nagłówka, w tej samej kolejności co wejście.
 *
 * Każda ścieżka błędu (brak klucza, timeout, HTTP, zły JSON, krótsza
 * odpowiedź) degraduje się do heurystyki — moduł ma działać bez AI, tylko
 * z uboższą oceną.
 */
export async function classifyMarketNews(
  titles: string[],
  assets: readonly MarketAsset[],
  keys: NewsClassifierKeys,
): Promise<MarketVerdict[]> {
  if (titles.length === 0) return [];
  const fallback = () => titles.map((t) => heuristicVerdict(t, assets));
  if (!keys.anthropicApiKey && !keys.geminiApiKey) return fallback();

  const system = systemPrompt(assets);
  const out: MarketVerdict[] = [];

  for (let i = 0; i < titles.length; i += CLASSIFY_BATCH) {
    const batch = titles.slice(i, i + CLASSIFY_BATCH);
    let text: string | null = null;

    if (keys.anthropicApiKey) {
      try {
        const contents: GeminiContent[] = [{ role: "user", parts: [{ text: userPrompt(batch) }] }];
        const result = await callAnthropic({
          apiKey: keys.anthropicApiKey,
          model: ANTHROPIC_NEWS_MODEL,
          systemPrompt: system,
          contents,
          maxOutputTokens: 8192,
          timeoutMs: MODEL_TIMEOUT_MS,
        });
        text = result.text || null;
      } catch {
        text = null;
      }
    }
    if (!text && keys.geminiApiKey) {
      text = await callGeminiForNews(keys.geminiApiKey, system, userPrompt(batch));
    }

    const parsed = text ? extractJsonArray(text) : null;
    if (!Array.isArray(parsed)) {
      out.push(...batch.map((t) => heuristicVerdict(t, assets)));
      continue;
    }
    // Krótsza odpowiedź niż paczka to nie błąd całości — brakujące pozycje
    // dostają heurystykę, reszta zostaje oceniona przez model.
    out.push(
      ...batch.map((title, idx) =>
        idx < parsed.length
          ? normalizeVerdict(parsed[idx], title, assets)
          : heuristicVerdict(title, assets),
      ),
    );
  }

  return out;
}

// ----------------------------------------------------------- pobieranie ----

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/rss+xml,application/xml,text/xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pobiera wszystkie kanały, odsiewa duplikaty i ocenia wpływ.
 *
 * Padnięty kanał nie wywraca zaciągu — reszta i tak wjeżdża, a lista
 * błędów wraca do wywołującego, żeby trafiła do System Logs.
 */
export async function ingestMarketNews(
  assets: readonly MarketAsset[],
  keys: NewsClassifierKeys,
  limit = 80,
): Promise<{ items: MarketNewsItem[]; errors: string[] }> {
  const errors: string[] = [];

  const perFeed = await Promise.all(
    MARKET_FEEDS.map(async (feed) => {
      try {
        return parseRss(await fetchText(feed.url), feed);
      } catch (err) {
        errors.push(`${feed.label}: ${err instanceof Error ? err.message : String(err)}`);
        return [] as RssItem[];
      }
    }),
  );

  const deduped = dedupeNews(perFeed.flat()).slice(0, limit);
  if (deduped.length === 0) return { items: [], errors };

  const verdicts = await classifyMarketNews(
    deduped.map((i) => i.title),
    assets,
    keys,
  );

  const items: MarketNewsItem[] = deduped.map((raw, idx) => {
    const verdict = verdicts[idx] ?? heuristicVerdict(raw.title, assets);
    return { ...raw, ...verdict };
  });

  return { items, errors };
}
