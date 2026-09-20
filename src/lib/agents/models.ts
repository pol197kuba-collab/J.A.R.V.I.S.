// Central list of model IDs surfaced in Settings + Agent Console dropdowns.
// Kept as a single source of truth so both places offer the same options.
//
// Two providers serve the main conversational turn:
//
//   * Google Gemini — bare IDs ("gemini-2.5-flash"). The app calls Google
//     directly with the user's key, so the IDs must match what the
//     Generative Language API accepts.
//   * Anthropic Claude — IDs carry an "anthropic:" prefix
//     ("anthropic:claude-opus-5"). The prefix is what routes a turn to the
//     Anthropic adapter (providers/anthropic.ts); everything after it is
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
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    hint: "Najmocniejsze rozumowanie w Gemini",
    provider: "gemini",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    hint: "Szybki, uniwersalny, tani",
    provider: "gemini",
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    hint: "Tani, do klasyfikacji",
    provider: "gemini",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Stabilna generacja 2.0",
    provider: "gemini",
  },
  {
    id: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    hint: "Najtańszy Flash",
    provider: "gemini",
  },
];

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

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

// Image generation (F.O.R.G.E. slide graphics). Not in GEMINI_MODELS on
// purpose — it's not a conversational model and shouldn't appear in the
// Settings/Console dropdowns.
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

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
  // Rdzeń: rozmowa, routing, delegacja do zespołu — najdłuższe łańcuchy
  // narzędziowe w całej aplikacji.
  jarvis: `${ANTHROPIC_PREFIX}claude-opus-5`,
  orchestrator: `${ANTHROPIC_PREFIX}claude-opus-5`,
  // Research wieloźródłowy i analiza dokumentów — tu jakość wnioskowania
  // przekłada się bezpośrednio na wynik.
  insight: `${ANTHROPIC_PREFIX}claude-opus-5`,
  researcher: `${ANTHROPIC_PREFIX}claude-opus-5`,
  metric: `${ANTHROPIC_PREFIX}claude-opus-5`,
  analityk: `${ANTHROPIC_PREFIX}claude-opus-5`,
  // Kod i sesje deweloperskie.
  droid: `${ANTHROPIC_PREFIX}claude-opus-5`,
  // Diagnostyka logów — dużo czytania, wnioski proste.
  shield: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  guardian: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  // Budowa plików: praca w dużej mierze mechaniczna (struktura slajdów),
  // ale treść nadal pisana przez model.
  forge: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  producer: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  // Copy / marketing.
  herald: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
  marketer: `${ANTHROPIC_PREFIX}claude-sonnet-5`,
};

// Groq — free-tier only, used internally for the UI-action classifier pass
// and emergency failover (see providers/groq.ts). Not user-selectable as a
// primary agent model, so no provider-prefix parsing is needed here; these
// are plain Groq model IDs passed straight to their API.
export const DEFAULT_GROQ_CLASSIFIER_MODEL = "llama-3.1-8b-instant";
export const DEFAULT_GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile";
