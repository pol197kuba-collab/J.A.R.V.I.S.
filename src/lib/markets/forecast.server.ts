// MARKET GRID — warstwa AI „typera". Etap 3.
//
// PODZIAŁ PRACY, który jest tu najważniejszy: wszystkie liczby (RSI,
// momentum, średnie, wydźwięk newsów) są policzone wcześniej, w
// deterministycznym TypeScripcie. Model dostaje je GOTOWE i ma je
// zinterpretować — wskazać kierunek, pewność i napisać uzasadnienie po
// polsku. Nie jest proszony o policzenie czegokolwiek, bo LLM proszony o
// RSI poda liczbę, która wygląda wiarygodnie i bywa nieprawdziwa.
//
// Prognoza sygnałowa istnieje niezależnie od modelu i jest zapisywana
// osobno. Dzięki temu panel skuteczności odpowiada na pytanie, które ma
// znaczenie: czy model bije prostą arytmetykę, czy tylko ładniej ją opisuje.
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { callAnthropic } from "@/lib/ai/llm/anthropic";
import { callGeminiText } from "@/lib/ai/llm/geminiText";
import type { GeminiContent } from "@/lib/ai/llm/types";
import { stripMarkers } from "@/lib/darwin/prompt";
import type { MarketAsset } from "./assets";
import type { SignalDirection, TechnicalOutlook } from "./signals";
import { REGIME_LABEL_PL, isMarketRegime } from "./regime";
import { estimateTokens, UNLIMITED_BUDGET, type ModelBudget } from "./budget";

const MODEL_TIMEOUT_MS = 120_000;
/**
 * Opus 5.5 myśli zawsze (nie da się wyłączyć) — effort "low" trzyma myślenie
 * krótkie, a limit wyjścia ma zapas na myślenie + odpowiedź. Do 6.11.2026
 * było Opus 5 z limitem ~2 600 tokenów: myślenie zjadało cały limit, tekst
 * wracał pusty i prognozy po cichu szły przez Gemini.
 */
const ANTHROPIC_FORECAST_MODEL = "claude-opus-5-5";

export type ForecastInput = {
  asset: MarketAsset;
  technical: TechnicalOutlook;
  /** Wypadkowy wydźwięk newsów, -100..100, albo null gdy newsów nie ma. */
  sentimentScore: number | null;
  sentimentItems: number;
  /** Kilka najmocniejszych nagłówków dotyczących instrumentu. */
  headlines: string[];
  lastPrice: number;
  /**
   * Pasmo „bez zmian" w % (scoreboard.flatBandPct) — wg niego prognoza jest
   * rozliczana, więc model musi je znać, żeby wiedzieć, co znaczy „flat".
   */
  flatBandPct?: number;
  /** Pasmo „bez zmian” horyzontu kontrolnego (7 dni). Podane = prośba o drugą prognozę. */
  controlBandPct?: number;
  /** Reżim rynku (regime.ts) — pokazywany tylko wariantowi z wnioskami. */
  regime?: string | null;
};

export type AiVerdict = {
  symbol: string;
  direction: SignalDirection;
  confidence: number;
  rationalePl: string | null;
  /**
   * Prognoza na horyzont kontrolny (7 dni) z tej samej odpowiedzi. null, gdy
   * model jej nie podał — wtedy nie zapisujemy nic (nie zmyślamy).
   */
  control: { direction: SignalDirection; confidence: number } | null;
};

/** Horyzont główny i kontrolny (dni). */
export const PRIMARY_HORIZON_DAYS = 2;
export const CONTROL_HORIZON_DAYS = 7;

/**
 * Dopisek systemowy: dwa horyzonty w jednej odpowiedzi i legenda skrótów
 * zwięzłego opisu instrumentów. Doklejany ZA promptem (także wariantem
 * Darwina), więc nie rusza zablokowanych sekcji — tylko je doprecyzowuje.
 */
export const HORIZONS_BLOCK = `

AKTUALIZACJA ZASAD 2 i FORMATU (ma pierwszeństwo przed wcześniejszą wzmianką o 7 dniach):
- Główna prognoza dotyczy ${PRIMARY_HORIZON_DAYS} dni (dla akcji, ETF, walut i surowców: 1 sesji; dla krypto: 2 dni) i jest rozliczana wg „pasmo 2d”. Pola: "direction", "confidence".
- Dodatkowo podaj prognozę kontrolną na 7 dni, rozliczaną wg „pasmo 7d”. Pola: "direction_7d", "confidence_7d". Obie oceniaj niezależnie — krótki ruch może iść pod prąd tygodniowego.
- Uzasadnienie ("rationale_pl") dotyczy prognozy głównej.
- Każda prognoza jest grana: "up" = kupno, "down" = krótka sprzedaż, "flat" = brak pozycji.
Legenda opisu: RSI14; mom5/mom20 = zmiana ceny z 5/20 sesji; SMA20/50 = odległość SMA20 od SMA50; zakres60 = pozycja ceny w zakresie 60 sesji (0 = dołek, 100 = szczyt); zmienność = roczna; sygnały = wynik arytmetyki (kierunek, pewność); newsy = wydźwięk −100..100 z N pozycji.
Obiekt: {"symbol","direction","confidence","direction_7d","confidence_7d","rationale_pl"}.`;

export const SYSTEM_PROMPT = `Jesteś analitykiem rynkowym. Dostajesz POLICZONE wskaźniki dla kilku instrumentów i Twoim zadaniem jest je zinterpretować.

ZASADY, od których nie wolno odstąpić:
1. NIE wymyślaj ani nie przeliczaj żadnych liczb. Wszystkie wartości (RSI, momentum, średnie, wydźwięk newsów, cena) masz podane i są prawdziwe. Możesz się do nich odwoływać, ale nie podawaj wartości, których nie dostałeś.
2. Prognoza dotyczy 7 dni i jest rozliczana wg podanego pasma „bez zmian" danego instrumentu: "up" = wzrost co najmniej o pasmo, "down" = spadek co najmniej o pasmo, "flat" = ruch mniejszy niż pasmo w obie strony. Pasmo jest dobrane do typowej zmienności instrumentu, więc każdy z trzech wyników jest z góry podobnie prawdopodobny.
3. Kierunek ma wynikać z podanych danych. Jeśli wskaźniki są sprzeczne albo słabe, poprawną odpowiedzią jest "flat" z niską pewnością — nie zgaduj kierunku, żeby coś powiedzieć.
4. Pewność odzwierciedla zgodność przesłanek, a nie Twoje przekonanie. Sprzeczne wskaźniki = niska pewność, nawet gdy kierunek wydaje się oczywisty.
5. Uzasadnienie po polsku, JEDNO do DWÓCH zdań, konkretnie: która przesłanka zdecydowała i co jej przeczy. Bez ogólników w rodzaju "rynek jest zmienny".
6. Nie obiecuj zysków, nie podawaj poziomów wejścia ani cen docelowych. To jest ocena prawdopodobnego kierunku, nie rekomendacja inwestycyjna.

Dla każdego instrumentu zwróć obiekt: {"symbol": "...", "direction": "up"|"down"|"flat", "confidence": 0-100, "rationale_pl": "..."}.
Odpowiedz WYŁĄCZNIE tablicą JSON, w tej samej kolejności co wejście, bez komentarza.`;

/** Slug typera w Darwinie (agent_variants) — pseudo-agent spoza tabeli `agents`. */
export const TYPER_SLUG = "typer";

/**
 * SYSTEM_PROMPT jako wariant pokolenia 0 dla Darwina, ze znacznikami sekcji
 * zablokowanych (src/lib/darwin/prompt.ts). Poza mutacją: rola i zasady
 * 1–2 (nie wymyślaj liczb, jak liczy się wynik) oraz zasada 6 i format
 * JSON (bez rekomendacji inwestycyjnych, kontrakt dla parsera). Mutować
 * wolno zasady 3–5 — jak ważyć przesłanki i pewność. Po zdjęciu znaczników
 * daje DOKŁADNIE SYSTEM_PROMPT, więc champion gen 0 = typer sprzed Darwina.
 */
export const TYPER_BASELINE = (() => {
  const free = SYSTEM_PROMPT.indexOf("\n3. ");
  const locked = SYSTEM_PROMPT.indexOf("\n6. ") + 1;
  return (
    `[[LOCK rola_i_dane]]${SYSTEM_PROMPT.slice(0, free)}[[/LOCK]]` +
    SYSTEM_PROMPT.slice(free, locked) +
    `[[LOCK zasady_i_format]]${SYSTEM_PROMPT.slice(locked)}[[/LOCK]]`
  );
})();

const fmt = (value: number | null, digits = 1): string =>
  value === null || !Number.isFinite(value) ? "brak" : value.toFixed(digits);

/** Opis jednego instrumentu dla modelu — same policzone fakty. */
/**
 * Część systemowa wariantu „z wnioskami". Wnioski są ZDANIAMI ZBUDOWANYMI
 * PRZEZ KOD z rozliczonych prognoz (lessons.ts) — model ich nie wymyśla,
 * tylko bierze pod uwagę obok wskaźników.
 */
export function lessonsBlock(lessons: string[]): string {
  return `

WNIOSKI Z TWOICH ROZLICZONYCH PROGNOZ (policzone z historii, prawdziwe):
${lessons.map((l) => `- ${l}`).join("\n")}

Jak z nich korzystać:
- Przy każdym instrumencie masz podaną „sytuację rynkową". Jeśli wniosek dotyczy tej sytuacji, potraktuj go jako ważną przesłankę obok wskaźników — także wtedy, gdy przeczy temu, co sugerują średnie i momentum.
- Wnioski pochodzą z kilku tygodni rynku, nie są prawem natury. Gdy wskaźniki są wyjątkowo jednoznaczne, możesz od nich odstąpić, ale wtedy napisz to w uzasadnieniu.
- Wnioski o złotówkach mówią, ile dawało ZAGRANIE prognozy: „up” = kupno, „down” = krótka sprzedaż, „flat” = brak pozycji (0 zł). „Flat” jest poprawne przy słabych danych, ale nic nie zarabia — kierunek wskazuj tam, gdzie wnioski w złotówkach pokazują, że w tej sytuacji zarabia, a unikaj tam, gdzie traci.
- Nie powołuj się na liczby, których tu nie ma.`;
}

export function describeForModel(
  input: ForecastInput,
  opts: { withRegime?: boolean } = {},
): string {
  const { asset, technical, sentimentScore, sentimentItems, headlines, lastPrice } = input;
  const s = technical.signals;

  // Cena podawana z rozsądną precyzją, nie surowym floatem: „81160.95006753"
  // w prompcie sugeruje modelowi dokładność, której notowanie nie ma, i
  // zjada tokeny bez żadnej wartości.
  const priceDigits = Math.abs(lastPrice) >= 100 ? 2 : Math.abs(lastPrice) >= 1 ? 4 : 6;

  // JEDNA linia na instrument, skróty objaśnione raz w HORIZONS_BLOCK —
  // przy kilkunastu instrumentach to ok. 40% mniej tokenów niż opis
  // wielowierszowy, a liczby są te same.
  const parts = [
    `${asset.symbol} (${asset.label}, ${asset.currency})`,
    `cena ${lastPrice.toFixed(priceDigits)}`,
    `RSI14 ${fmt(s.rsi, 0)}`,
    `mom5 ${fmt(s.momentum5)}%`,
    `mom20 ${fmt(s.momentum20)}%`,
    `SMA20/50 ${
      s.sma20 !== null && s.sma50 !== null
        ? `${(((s.sma20 - s.sma50) / s.sma50) * 100).toFixed(1)}%`
        : "brak"
    }`,
    `zakres60 ${fmt(s.rangePosition, 0)}%`,
    `zmienność ${fmt(s.volatility, 0)}%`,
    ...(opts.withRegime && input.regime && isMarketRegime(input.regime)
      ? [`sytuacja: ${REGIME_LABEL_PL[input.regime]}`]
      : []),
    ...(input.flatBandPct !== undefined
      ? [
          `pasmo 2d ±${input.flatBandPct.toFixed(2)}%` +
            (input.controlBandPct !== undefined
              ? `, pasmo 7d ±${input.controlBandPct.toFixed(2)}%`
              : ""),
        ]
      : []),
    `sygnały ${technical.score} (${technical.direction}, ${technical.confidence})`,
    `newsy: ${
      sentimentScore === null || sentimentItems === 0
        ? "brak"
        : `${sentimentScore} z ${sentimentItems}`
    }`,
  ];
  if (headlines.length > 0) {
    parts.push(
      `nagłówki: ${headlines
        .slice(0, 2)
        .map((h) => `„${h.length > 90 ? `${h.slice(0, 89)}…` : h}"`)
        .join("; ")}`,
    );
  }
  return parts.join(" | ");
}

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

type RawVerdict = {
  symbol?: unknown;
  direction?: unknown;
  confidence?: unknown;
  rationale_pl?: unknown;
  direction_7d?: unknown;
  confidence_7d?: unknown;
};

const asDirection = (v: unknown): SignalDirection | null =>
  v === "up" || v === "down" || v === "flat" ? v : null;

/**
 * Normalizuje jeden werdykt modelu do kształtu, któremu ufa reszta modułu.
 *
 * Gdy model zwróci bzdurę, spadamy na werdykt sygnałowy dla tego
 * instrumentu — nigdy na „flat z pewnością 50", bo to byłaby wymyślona
 * prognoza podpisana jako ocena modelu i zafałszowałaby panel skuteczności.
 */
export function normalizeAiVerdict(raw: unknown, input: ForecastInput): AiVerdict {
  const fallback: AiVerdict = {
    symbol: input.asset.symbol,
    direction: input.technical.direction,
    confidence: input.technical.confidence,
    rationalePl: null,
    control: null,
  };
  if (typeof raw !== "object" || raw === null) return fallback;
  const row = raw as RawVerdict;

  const direction: SignalDirection | null =
    row.direction === "up" || row.direction === "down" || row.direction === "flat"
      ? row.direction
      : null;
  if (!direction) return fallback;

  const confRaw = typeof row.confidence === "number" ? row.confidence : Number(row.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.max(0, Math.min(100, Math.round(confRaw)))
    : input.technical.confidence;

  const rationalePl =
    typeof row.rationale_pl === "string" && row.rationale_pl.trim()
      ? row.rationale_pl.trim().slice(0, 400)
      : null;

  // Kontrolna 7d: tylko gdy model ją podał — brak = brak, nie kopia głównej.
  const controlDir = asDirection(row.direction_7d);
  const c7Raw =
    typeof row.confidence_7d === "number" ? row.confidence_7d : Number(row.confidence_7d);
  const control = controlDir
    ? {
        direction: controlDir,
        confidence: Number.isFinite(c7Raw)
          ? Math.max(0, Math.min(100, Math.round(c7Raw)))
          : confidence,
      }
    : null;

  return { symbol: input.asset.symbol, direction, confidence, rationalePl, control };
}

export type ForecastKeys = {
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
};

export type ForecastResult = {
  verdicts: AiVerdict[];
  /** Który model faktycznie odpowiedział; null = żaden, użyto sygnałów. */
  model: string | null;
  /**
   * Dlaczego nie ma werdyktu modelu, gdy klucz był podany — każdy dostawca po
   * kolei. null, gdy model odpowiedział albo nie było żadnego klucza. Bez
   * tego prognozy „ai" znikały na trzy tygodnie i nikt nie wiedział czemu.
   */
  failure: string | null;
};

/**
 * Prosi model o interpretację policzonych wskaźników.
 *
 * Bez klucza (albo po awarii obu dostawców) zwraca werdykty sygnałowe z
 * model = null — wtedy warstwa zapisu wie, że nie ma czego zapisywać jako
 * prognozy „ai", i nie podpisze arytmetyki nazwiskiem modelu.
 */
export async function forecastWithModel(
  inputs: ForecastInput[],
  keys: ForecastKeys,
  opts: {
    /**
     * Wnioski z rozliczonych prognoz. Podane = wariant „z wnioskami" testu
     * A/B (ten sam model, ten sam prompt + wnioski + sytuacja rynkowa);
     * brak = wariant kontrolny, dokładnie taki jak przed testem.
     */
    lessons?: string[];
    /**
     * Prompt wariantu Darwina (ze znacznikami blokad). Brak = SYSTEM_PROMPT.
     * Ten sam wariant idzie do prognozy kontrolnej i „z wnioskami”, więc
     * porównanie A/B wniosków zostaje uczciwe.
     */
    strategy?: string;
    /** Strażnik dziennego budżetu tokenów; brak = bez limitu (testy). */
    budget?: ModelBudget;
  } = {},
): Promise<ForecastResult> {
  const fallback: ForecastResult = {
    verdicts: inputs.map((i) => ({
      symbol: i.asset.symbol,
      direction: i.technical.direction,
      confidence: i.technical.confidence,
      rationalePl: null,
      control: null,
    })),
    model: null,
    failure: null,
  };
  if (inputs.length === 0) return { verdicts: [], model: null, failure: null };
  if (!keys.anthropicApiKey && !keys.geminiApiKey) return fallback;

  const learned = opts.lessons !== undefined;
  const base = opts.strategy ? stripMarkers(opts.strategy) : SYSTEM_PROMPT;
  const withHorizons = inputs.some((i) => i.controlBandPct !== undefined);
  const system =
    base + (withHorizons ? HORIZONS_BLOCK : "") + (learned ? lessonsBlock(opts.lessons ?? []) : "");
  const user = inputs.map((i) => describeForModel(i, { withRegime: learned })).join("\n");

  // Budżet: szacunek wejścia + ~80 tokenów odpowiedzi na instrument.
  const budget = opts.budget ?? UNLIMITED_BUDGET;
  const purpose = learned ? "forecast_learned" : "forecast";
  const estimate = estimateTokens(system + user) + inputs.length * 80;
  const denied = await budget.check(purpose, estimate);
  if (denied) return { ...fallback, failure: `budżet tokenów — ${denied}` };
  // Odpowiedź z dwoma horyzontami jest dłuższa — limit wyjścia z zapasem.
  const maxOutputTokens = Math.min(8192, 400 + inputs.length * 160);
  // Claude: myślenie wlicza się do max_tokens — osobny, większy limit.
  const claudeMaxTokens = Math.min(16_000, 3_000 + inputs.length * 250);
  let text: string | null = null;
  let model: string | null = null;
  const failures: string[] = [];

  if (keys.anthropicApiKey) {
    try {
      const contents: GeminiContent[] = [{ role: "user", parts: [{ text: user }] }];
      const result = await callAnthropic({
        apiKey: keys.anthropicApiKey,
        model: ANTHROPIC_FORECAST_MODEL,
        systemPrompt: system,
        contents,
        maxOutputTokens: claudeMaxTokens,
        effort: "low",
        timeoutMs: MODEL_TIMEOUT_MS,
        ledger: budget.ledger?.(purpose),
      });
      text = result.text || null;
      await budget.record(purpose, {
        model: ANTHROPIC_FORECAST_MODEL,
        tokensIn: result.tokensIn + (result.cacheReadTokens ?? 0) + (result.cacheWriteTokens ?? 0),
        tokensOut: result.tokensOut,
        estimated: false,
      });
      if (text) model = ANTHROPIC_FORECAST_MODEL;
      else failures.push("Claude: pusta odpowiedź");
    } catch (err) {
      text = null;
      failures.push(`Claude: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  if (!text && keys.geminiApiKey) {
    // Widoczne w logu joba — bez tego zapas na Gemini działał niezauważony.
    if (failures.length > 0)
      console.warn(`[prognozy] Claude zawiódł, zapas Gemini: ${failures.join(" · ")}`);
    const gemini = await callGeminiText({
      apiKey: keys.geminiApiKey,
      model: DEFAULT_GEMINI_MODEL,
      system,
      user,
      timeoutMs: MODEL_TIMEOUT_MS,
      ledger: budget.ledger?.(purpose),
    });
    if (gemini.ok) {
      text = gemini.text;
      model = DEFAULT_GEMINI_MODEL;
      await budget.record(purpose, {
        model,
        tokensIn: estimateTokens(system + user),
        tokensOut: estimateTokens(gemini.text),
        estimated: true,
      });
    } else {
      failures.push(gemini.reason);
    }
  }

  const parsed = text ? extractJsonArray(text) : null;
  if (!Array.isArray(parsed)) {
    if (text) failures.push(`${model}: odpowiedź nie jest tablicą JSON`);
    return { ...fallback, failure: failures.join(" · ") || null };
  }

  // Dopasowanie po symbolu, nie po pozycji: model bywa kreatywny z
  // kolejnością, a przesunięcie werdyktów o jeden przypisałoby ocenę
  // Bitcoina do złota — błąd cichy i kompletnie mylący.
  const bySymbol = new Map<string, unknown>();
  for (const row of parsed) {
    const symbol =
      typeof row === "object" && row !== null && typeof (row as RawVerdict).symbol === "string"
        ? String((row as RawVerdict).symbol)
            .trim()
            .toUpperCase()
        : null;
    if (symbol) bySymbol.set(symbol, row);
  }

  return {
    verdicts: inputs.map((input, idx) =>
      normalizeAiVerdict(bySymbol.get(input.asset.symbol) ?? parsed[idx], input),
    ),
    model,
    failure: null,
  };
}
