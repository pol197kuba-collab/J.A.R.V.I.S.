// Central list of Gemini model IDs surfaced in Settings + Agent Console dropdowns.
// Kept as a single source of truth so both places offer the same options.
//
// The IDs must match what the Google Generative Language API accepts, because
// this app calls Google directly using the user's API key (server-side).

export type GeminiModelOption = {
  id: string;
  label: string;
  hint?: string;
};

export const GEMINI_MODELS: GeminiModelOption[] = [
  { id: "gemini-flash-latest", label: "Flash · latest", hint: "Zawsze najnowszy Flash" },
  { id: "gemini-pro-latest", label: "Pro · latest", hint: "Zawsze najnowszy Pro" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Najmocniejszy rozumowanie" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Szybki, uniwersalny" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", hint: "Tani, do klasyfikacji" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Stabilna generacja 2.0" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", hint: "Najtańszy Flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (preview)", hint: "Wymaga dostępu preview" },
  { id: "gemini-3-pro-latest", label: "Gemini 3 Pro (preview)", hint: "Wymaga dostępu preview" },
];

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const isKnownGeminiModel = (id: string): boolean => GEMINI_MODELS.some((m) => m.id === id);

// Groq — free-tier only, used internally for the UI-action classifier pass
// and emergency failover (see providers/groq.ts). Not yet exposed as a
// user-selectable primary agent model, so no provider-prefix parsing is
// needed yet; these are plain Groq model IDs passed straight to their API.
export const DEFAULT_GROQ_CLASSIFIER_MODEL = "llama-3.1-8b-instant";
export const DEFAULT_GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile";
