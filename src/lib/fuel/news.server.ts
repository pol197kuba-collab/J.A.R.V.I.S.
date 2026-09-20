// Ocena wpływu newsów na cenę paliwa przez Gemini. Osobny plik `.server.ts`,
// bo klucz API nigdy nie może trafić do bundla klienta.
//
// Jedno wywołanie na całą paczkę (nie jedno na news): kilkadziesiąt
// oddzielnych żądań to kilkadziesiąt okazji do rate-limitu i kilkadziesiąt
// razy dłuższe odświeżenie, a model i tak ocenia każdy tytuł niezależnie.
import { heuristicImpact, type ImpactVerdict, type NewsItem } from "./news";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT = `Jesteś analitykiem rynku paliw. Oceniasz, jak nagłówek prasowy wpływa na HURTOWE CENY PALIW w Polsce (cennik Orlenu).

Dla każdego nagłówka zwróć:
- impact: "bullish" gdy news sprzyja WZROSTOWI ceny paliwa (ograniczenie podaży, sankcje, awarie, eskalacja, słabszy złoty), "bearish" gdy sprzyja SPADKOWI (wzrost wydobycia, nadpodaż, słabszy popyt, deeskalacja, mocniejszy złoty), "neutral" gdy związek jest żaden lub niejasny.
- score: 0-100, jak mocno ten news może ruszyć ceną. Lokalna ciekawostka to 10-25, decyzja OPEC+ albo sankcje na dużego eksportera to 70-95.
- summary_pl: JEDNO zdanie po polsku (maks. 160 znaków) mówiące, co to oznacza dla ceny paliwa. Bez powtarzania tytułu.

Nie zgaduj kierunku na siłę — "neutral" jest poprawną odpowiedzią. Odpowiedz wyłącznie tablicą JSON, w tej samej kolejności co wejście, bez komentarza.`;

type GeminiVerdict = { impact?: unknown; score?: unknown; summary_pl?: unknown };

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

function normalizeVerdict(raw: unknown, fallbackTitle: string): ImpactVerdict {
  if (typeof raw !== "object" || raw === null) return heuristicImpact(fallbackTitle);
  const row = raw as GeminiVerdict;

  const impact =
    row.impact === "bullish" || row.impact === "bearish" || row.impact === "neutral"
      ? row.impact
      : null;
  if (!impact) return heuristicImpact(fallbackTitle);

  const scoreRaw = typeof row.score === "number" ? row.score : Number(row.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 50;

  const summary =
    typeof row.summary_pl === "string" && row.summary_pl.trim()
      ? row.summary_pl.trim().slice(0, 240)
      : null;

  return { impact, score, summaryPl: summary, classifiedBy: "gemini" };
}

/**
 * Zwraca werdykt dla każdego newsa, w tej samej kolejności co wejście.
 * Każda ścieżka błędu (brak klucza, timeout, HTTP, zły JSON, krótsza
 * odpowiedź) degraduje się do heurystyki — moduł ma działać bez AI, tylko
 * z uboższą oceną.
 */
export async function classifyNewsImpact(
  items: NewsItem[],
  apiKey: string | null,
): Promise<ImpactVerdict[]> {
  if (items.length === 0) return [];
  if (!apiKey) return items.map((i) => heuristicImpact(i.title));

  const numbered = items.map((item, i) => `${i + 1}. [${item.feedTag}] ${item.title}`).join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: numbered }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) return items.map((i) => heuristicImpact(i.title));

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) return items.map((i) => heuristicImpact(i.title));

    return items.map((item, i) =>
      i < parsed.length ? normalizeVerdict(parsed[i], item.title) : heuristicImpact(item.title),
    );
  } catch {
    return items.map((i) => heuristicImpact(i.title));
  } finally {
    clearTimeout(timer);
  }
}
