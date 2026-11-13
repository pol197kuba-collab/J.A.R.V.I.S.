// Cennik modeli i przeliczanie zużycia na pieniądze.
//
// DLACZEGO OSOBNY PLIK, SKORO STAWKI SĄ JUŻ W PODPOWIEDZIACH MODELI. Tam są
// tekstem dla oka („$5→$25 / 1M"), tutaj liczbami dla arytmetyki. Jedno i
// drugie musi mówić to samo, ale tylko to drugie da się zsumować — a licznik
// kosztów liczony z napisu to dokładnie ten rodzaj pomysłu, który działa do
// pierwszej zmiany formatowania.
//
// CZEGO TEN LICZNIK NIE JEST. Nie jest rachunkiem. Liczy z tego, co zwrócił
// dostawca w polu `usage`, po cenniku wpisanym ręcznie i opatrzonym datą.
// Źródłem prawdy pozostaje konsola rozliczeniowa dostawcy; to jest narzędzie
// do odpowiadania na pytanie „dlaczego dziś trzy razy więcej niż wczoraj",
// nie do rozliczeń co do centa. Interfejs ma to mówić wprost.

/** Zużycie jednego przebiegu, w tokenach. */
export type TokenUsage = {
  input: number;
  output: number;
  /** Tokeny odczytane z cache'u dostawcy — tańsze od zwykłego wejścia. */
  cacheRead?: number;
  /** Tokeny zapisane do cache'u — DROŻSZE od zwykłego wejścia. */
  cacheWrite?: number;
};

type Rate = {
  /** USD za milion tokenów wejściowych. */
  inputPerM: number;
  /** USD za milion tokenów wyjściowych. */
  outputPerM: number;
  /** USD za milion tokenów odczytanych z cache, gdy inna niż 0,1 × wejście. */
  cacheReadPerM?: number;
};

/**
 * Stawki za milion tokenów, w USD. Klucz to identyfikator modelu BEZ prefiksu
 * dostawcy — prefiks zdejmujemy przed odczytem, bo `anthropic:claude-opus-5`
 * i `claude-opus-5` to ten sam model i ta sama cena.
 *
 * Zweryfikowane: Anthropic 2026-11-06; Gemini 2026-11-11 (2.5 Flash,
 * 2.5 Flash-Lite, embedding); Groq 2026-11-13 (patrz niżej). Przy aktualizacji
 * zmieniaj TĘ datę razem z liczbami — cennik bez daty po pół roku jest gorszy niż jego brak, bo
 * wygląda na aktualny.
 */
export const PRICING_VERIFIED_ON = "2026-11-11";

const RATES: Readonly<Record<string, Rate>> = {
  // Anthropic — ceny pierwszej strony API.
  // Odczyt z cache 0,05× (sprawdzone w dokumentacji Claude API 2026-11-11).
  "claude-opus-5-5": { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2 },
  "claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1 },
  "claude-haiku-5-5": { inputPerM: 0.1, outputPerM: 0.5 },
  "claude-opus-5": { inputPerM: 5, outputPerM: 25 },
  "claude-sonnet-5": { inputPerM: 2, outputPerM: 10 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },

  // Google — poziom płatny. UWAGA: przy kluczu na darmowym poziomie realny
  // koszt wynosi zero, a licznik i tak go naliczy. Zawyżanie jest tu
  // bezpieczniejsze niż zaniżanie: budżet zadziała wcześniej, nie później.
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-flash-latest": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 },
  "gemini-pro-latest": { inputPerM: 1.25, outputPerM: 10 },
  // Sprawdzone 2026-11-13 na aistudio.google.com/docs/pricing (poziom płatny).
  // 3.8/3.6 Flash: stawka do 2026-12-31; od 2027-01-01 $1.50 → $7.50.
  "gemini-4-hydrogen": { inputPerM: 1.5, outputPerM: 7.5 },
  "gemini-3.8-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  "gemini-3.6-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  "gemini-3.5-flash-lite": { inputPerM: 0.3, outputPerM: 2.5 },
  // Dopisane 2026-11-11 (etap 2), stawki ze strony cennika Gemini.
  "gemini-2.5-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
  // Embeddingi: płaci się tylko za wejście.
  "gemini-embedding-001": { inputPerM: 0.15, outputPerM: 0 },

  // Groq — sprawdzone 2026-11-13 na console.groq.com/docs/models.
  // llama-3.1-8b-instant i llama-3.3-70b-versatile (domyślne modele
  // aplikacji) są tam „Enterprise” z ceną „Contact Sales” — publicznej stawki
  // nie ma. Zostaje ostatnia publiczna, żeby księga nie gubiła kosztu
  // (na darmowym kluczu realnie zero — licznik zawyża, bezpieczny kierunek).
  "llama-3.1-8b-instant": { inputPerM: 0.05, outputPerM: 0.08 },
  "llama-3.3-70b-versatile": { inputPerM: 0.59, outputPerM: 0.79 },
  // Publiczne stawki (Developer plan), sprawdzone 2026-11-13:
  "openai/gpt-oss-20b": { inputPerM: 0.075, outputPerM: 0.3 },
  "openai/gpt-oss-120b": { inputPerM: 0.15, outputPerM: 0.6 },
};

/** Mnożnik stawki wejściowej dla tokenów odczytanych z cache'u. */
const CACHE_READ_MULTIPLIER = 0.1;

/** Mnożnik stawki wejściowej dla tokenów zapisywanych do cache'u. */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Identyfikator bez prefiksu dostawcy. */
export function bareModelId(model: string): string {
  const colon = model.indexOf(":");
  return colon === -1 ? model : model.slice(colon + 1);
}

/** Czy znamy stawkę dla tego modelu. */
export function hasPricing(model: string): boolean {
  return bareModelId(model) in RATES;
}

/**
 * Koszt przebiegu w USD.
 *
 * Zwraca `null` dla modelu spoza cennika — CELOWO, zamiast zera. Zero
 * znaczyłoby „nic nie kosztowało", a prawda brzmi „nie wiem, ile kosztowało".
 * Wrzucenie nieznanego modelu do sumy jako zera po cichu zaniżałoby budżet i
 * to akurat w momencie, w którym ktoś dołożył nowy, nieopisany model.
 */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const rate = RATES[bareModelId(model)];
  if (!rate) return null;

  const perToken = rate.inputPerM / 1_000_000;
  const input = Math.max(0, usage.input) * perToken;
  const cacheReadPerToken =
    rate.cacheReadPerM !== undefined
      ? rate.cacheReadPerM / 1_000_000
      : perToken * CACHE_READ_MULTIPLIER;
  const cacheRead = Math.max(0, usage.cacheRead ?? 0) * cacheReadPerToken;
  const cacheWrite = Math.max(0, usage.cacheWrite ?? 0) * perToken * CACHE_WRITE_MULTIPLIER;
  const output = (Math.max(0, usage.output) * rate.outputPerM) / 1_000_000;

  // Sześć miejsc: pojedyncza krótka tura potrafi kosztować ułamek centa, a
  // zaokrąglenie do centa zamieniłoby setkę takich tur w zero.
  return Math.round((input + cacheRead + cacheWrite + output) * 1_000_000) / 1_000_000;
}

/** Kwota po ludzku: „$0,0042" albo „$1,27". */
export function formatUsd(value: number): string {
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toFixed(digits).replace(".", ",")}`;
}
