// Central list of model IDs surfaced in Settings + Agent Console dropdowns.
// Kept as a single source of truth so both places offer the same options.
//
// Two providers serve the main conversational turn:
//
//   * Google Gemini — bare IDs ("gemini-3.8-flash"). The app calls Google
//     directly with the user's key, so the IDs must match what the
//     Generative Language API accepts.
//   * Anthropic Claude — IDs carry an "anthropic:" prefix
//     ("anthropic:claude-opus-5"). The prefix is what routes a turn to the
//     Anthropic adapter (llm/anthropic.ts); everything after it is
//     passed to the Messages API verbatim.
//
// A bare ID always means Gemini — that keeps every model value written
// before multi-provider routing existed (agents.model, user_settings
// .default_model) valid without a data migration.
//
// Groq stays out of this list on purpose: it is never a user-selectable
// primary model, only the internal classifier + failover tier.

export type ModelProvider = "gemini" | "anthropic";

export type ModelOption = {
  id: string;
  label: string;
  hint?: string;
  provider: ModelProvider;
};

/** Back-compat alias — this type was Gemini-only before Claude was added. */
export type GeminiModelOption = ModelOption;

export const ANTHROPIC_PREFIX = "anthropic:";

// LISTA ZAPASOWA, nie źródło prawdy. Prawdziwą listę pobiera
// listAvailableModels z API dostawcy (patrz ./modelCatalog.ts); te wpisy
// pokazują się tylko na czas ładowania, przy braku klucza albo gdy API nie
// odpowiada — i dlatego zawierają wyłącznie identyfikatory, o których
// wiadomo, że API je przyjmowało.
export const GEMINI_MODELS: ModelOption[] = [
  {
    id: "gemini-flash-latest",
    label: "Flash · latest",
    hint: "Zawsze najnowszy Flash",
    provider: "gemini",
  },
  {
    id: "gemini-pro-latest",
    label: "Pro · latest",
    hint: "Zawsze najnowszy Pro",
    provider: "gemini",
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    hint: "Najnowszy, mocne rozumowanie · $1.50→$7.50 / 1M",
    provider: "gemini",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    hint: "Szybki, agentowy, domyślny · $0.75→$3.75 / 1M",
    provider: "gemini",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    hint: "Poprzedni Flash · $0.75→$3.75 / 1M",
    provider: "gemini",
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    hint: "Najtańszy, do prostych zadań · $0.30→$2.50 / 1M",
    provider: "gemini",
  },
];

// USUNIĘTE 2026-11-13: "gemini-2.5-pro", "gemini-2.5-flash" (wycofane
// 2026-11-02, wyłączenie 2026-12-01, dostęp tylko dla dotychczasowych
// użytkowników) i "gemini-2.5-flash-lite" (bez daty, ale Google zaleca nowe
// modele) — strony aistudio.google.com/docs/deprecations i /docs/models,
// sprawdzone 2026-11-13. Modele 3.x/4.x wymagają innych parametrów
// (geminiCompat.ts) i podpisów myślenia w pętli narzędzi.

// USUNIĘTE (etap 6b): "gemini-2.0-flash" i "gemini-2.0-flash-lite" — Google
// wyłączył je 2026-06-01 (strona deprecations Gemini API, sprawdzona
// 2026-11-13). Agent, który ma je w bazie, schodzi na model domyślny
// z ostrzeżeniem (turn.server.ts, 404).

// USUNIĘTE ŚWIADOMIE: "gemini-3.5-flash" i "gemini-3-pro-latest". Pierwszy
// był na tej liście i okazał się nieprzyjmowany przez API — migracja
// 20260710061408 musiała cofnąć użytkowników na 2.5-flash. Zgadywanie
// identyfikatorów przyszłych modeli jest dokładnie tym, co ta lista ma
// przestać robić: modele spoza tej listy pojawią się w dropdownie same,
// gdy API klucza je wymieni (listAvailableModels + modelCatalog.ts).

// Anthropic Claude — jak wyżej, lista zapasowa. Wymaga własnego klucza
// (Ustawienia → Claude). Ceny
// podane jako $ za 1M tokenów wejścia → wyjścia, żeby wybór w dropdownie był
// świadomy: Claude jest o rząd wielkości droższy od Gemini Flash i ma sens
// tam, gdzie liczy się jakość rozumowania i wieloetapowe użycie narzędzi.
export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: `${ANTHROPIC_PREFIX}claude-opus-5`,
    label: "Claude Opus 5",
    hint: "Najmocniejszy · $5→$25 / 1M",
    provider: "anthropic",
  },
  {
    id: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
    label: "Claude Sonnet 5",
    hint: "Mocny i tańszy · $2→$10 / 1M",
    provider: "anthropic",
  },
  {
    id: `${ANTHROPIC_PREFIX}claude-haiku-4-5`,
    label: "Claude Haiku 4.5",
    hint: "Szybki, do prostych zadań · $1→$5 / 1M",
    provider: "anthropic",
  },
];

export const ALL_MODELS: ModelOption[] = [...GEMINI_MODELS, ...ANTHROPIC_MODELS];

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const isKnownGeminiModel = (id: string): boolean => GEMINI_MODELS.some((m) => m.id === id);

export const isKnownModel = (id: string): boolean => ALL_MODELS.some((m) => m.id === id);

/**
 * Splits a stored model reference into the provider that must serve it and
 * the ID that provider's API expects. Unprefixed = Gemini, so every value
 * written before multi-provider routing keeps working untouched.
 */
export function parseModelRef(ref: string): { provider: ModelProvider; modelId: string } {
  const trimmed = ref.trim();
  if (trimmed.toLowerCase().startsWith(ANTHROPIC_PREFIX)) {
    return { provider: "anthropic", modelId: trimmed.slice(ANTHROPIC_PREFIX.length).trim() };
  }
  return { provider: "gemini", modelId: trimmed };
}

export const modelLabel = (ref: string): string =>
  ALL_MODELS.find((m) => m.id === ref)?.label ?? ref;

// Rekomendowany podział modeli per agent — używany przez przycisk
// „Zastosuj rekomendowany podział" w Ustawieniach. Zasada: model rozumujący
// tam, gdzie agent prowadzi wieloetapową pracę z narzędziami i wnioskuje;
// tańszy tam, gdzie zadanie jest mechaniczne (formatowanie, copy).
// Agenci spoza tej mapy zostają na tym, co mają (najczęściej: dziedziczą
// globalny domyślny model).
export const RECOMMENDED_AGENT_MODELS: Readonly<Record<string, string>> = {
  // Podział „mieszany” wybrany przez właściciela 2026-11-13. Rozmowa i
  // routing muszą być szybkie — Opus potrafił odpowiadać ponad minutę.
  jarvis: "gemini-3.8-flash",
  // Research wieloźródłowy i analiza danych — tu jakość wnioskowania
  // przekłada się na wynik, więc Claude (Sonnet: mocny, 2,5× tańszy od Opusa).
  insight: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  metric: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  // Reszta: szybki Flash z natywnym wyszukiwaniem Google.
  droid: "gemini-3.8-flash",
  shield: "gemini-3.8-flash",
  forge: "gemini-3.8-flash",
  herald: "gemini-3.8-flash",
};

// Groq — free-tier only, used internally for the UI-action classifier pass
// and emergency failover (see llm/groq.ts). Not user-selectable as a
// primary agent model, so no provider-prefix parsing is needed here; these
// are plain Groq model IDs passed straight to their API.
//
// Etap 6b (decyzja właściciela 2026-11-13): Llama 3.1 8B / 3.3 70B są na
// console.groq.com/docs/models „Enterprise / Contact Sales” — na zwykłym
// koncie mogą nie działać. GPT-OSS to modele produkcyjne Developer planu
// z publiczną ceną; myślą (reasoning), patrz REASONING_* w llm/groq.ts.
export const DEFAULT_GROQ_CLASSIFIER_MODEL = "openai/gpt-oss-20b";
export const DEFAULT_GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";
