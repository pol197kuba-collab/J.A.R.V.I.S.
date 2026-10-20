// Klucze zewnętrznych dostawców: kto od czego zależy i jak rozpoznać, że
// klucz przestał działać.
//
// Czyste — bez sieci i bazy. Korzystają z tego trzy miejsca: zakładka
// ustawień (opisy przy kluczach), test kluczy (keyCheck.functions.ts) i alarm
// o padniętym kluczu (providerAlarm.server.ts), więc opis „co się stanie" i
// rozpoznawanie błędu żyją w jednym miejscu.

export type ProviderId = "gemini" | "anthropic" | "groq" | "google_cse" | "github";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Czy aplikacja działa bez niego. */
  required: boolean;
  /** Które moduły go używają. */
  modules: string;
  /** Co się dzieje, gdy klucza brak albo nie działa. */
  ifBroken: string;
  /** Skąd go wziąć. */
  source: string;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    required: true,
    modules:
      "Rozmowa z J.A.R.V.I.S.-em, web search, pamięć, Vision, Mózg, dokumenty, notatki, newsy paliw i rynków, briefing.",
    ifBroken:
      "Większość modułów AI przestaje odpowiadać. Rozmowa przejdzie na Groq, jeśli jest klucz.",
    source: "aistudio.google.com → Get API key (darmowy tier)",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    required: false,
    modules: "Agenci ustawieni na model Claude, prognozy typera rynków, briefing.",
    ifBroken: "Ci agenci przechodzą na Gemini (słabsze odpowiedzi), typer zapisuje same sygnały.",
    source: "console.anthropic.com → API Keys (płatny, za tokeny)",
  },
  {
    id: "groq",
    label: "Groq",
    required: false,
    modules: "Rozpoznawanie komend UI i awaryjna zapasówka, gdy Gemini padnie.",
    ifBroken: "Komendy UI rozpoznaje Gemini, a awaria Gemini kończy rozmowę błędem.",
    source: "console.groq.com → API Keys (darmowy)",
  },
  {
    id: "google_cse",
    label: "Google Custom Search",
    required: false,
    modules: "Prawdziwe zdjęcia w dokumentach F.O.R.G.E.",
    ifBroken: "Zdjęcia są szukane w darmowych źródłach (Wikipedia, Openverse) — mniej trafnie.",
    source: "console.cloud.google.com (klucz) + programmablesearchengine.google.com (cx)",
  },
  {
    id: "github",
    label: "GitHub",
    required: false,
    modules:
      "D.R.O.I.D.: zadania programistyczne (issue) i podgląd repozytoriów; poranny briefing i Market Grid o czasie (uruchamia joby).",
    ifBroken:
      "D.R.O.I.D. nie założy issue ani nie zajrzy do repo; briefing i Market Grid czekają na cron GitHuba (bywa spóźniony o godziny).",
    source:
      "github.com/settings/personal-access-tokens (Issues: read/write, Contents: read, Actions: read/write — Actions uruchamia briefing i Market Grid o czasie)",
  },
];

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id)!;

/** Powody, dla których klucz nie działa — każdy wymaga ręcznej naprawy. */
export type KeyFailureReason = "invalid_key" | "no_credit" | "api_disabled" | "forbidden";

export const REASON_LABEL: Record<KeyFailureReason, string> = {
  invalid_key: "nieprawidłowy klucz",
  no_credit: "brak środków na koncie",
  api_disabled: "API wyłączone w projekcie Google Cloud",
  forbidden: "brak uprawnień",
};

export const REASON_FIX: Record<KeyFailureReason, string> = {
  invalid_key: "Wygeneruj nowy klucz i wklej go ponownie (bez spacji i cudzysłowów).",
  no_credit: "Doładuj konto u dostawcy (Billing).",
  api_disabled:
    "Włącz to API w projekcie Google Cloud (dla Gemini: Generative Language API) albo weź klucz z AI Studio.",
  forbidden: "Klucz nie ma dostępu do tego zasobu — sprawdź jego uprawnienia.",
};

export type ProviderFailure = { provider: ProviderId; reason: KeyFailureReason };

/**
 * Rozpoznaje w treści błędu (status HTTP + ciało odpowiedzi dostawcy) awarię
 * klucza. Zwraca tylko powody wymagające ręcznej naprawy — limit zapytań,
 * 5xx czy timeout mijają same i nie są powodem do alarmu.
 */
export function classifyKeyFailure(
  provider: ProviderId,
  status: number | null,
  body: string,
): KeyFailureReason | null {
  const text = body.toLowerCase();
  if (/credit balance is too low|insufficient[_ ]quota|billing/.test(text)) return "no_credit";
  if (/has not been used in project|is disabled|service_disabled|api_not_activated/.test(text))
    return "api_disabled";
  if (
    status === 401 ||
    /invalid x-api-key|authentication_error|api_key_invalid|api key not valid|invalid_api_key|bad credentials/.test(
      text,
    )
  )
    return "invalid_key";
  if (status === 403) return provider === "gemini" ? "api_disabled" : "forbidden";
  return null;
}

const SEGMENT_PROVIDER: Record<string, ProviderId> = {
  anthropic: "anthropic",
  gemini: "gemini",
  groq: "groq",
};

/**
 * Wyciąga awarie kluczy z wpisu logu. Wpis potrafi zawierać kilku dostawców
 * naraz („Claude: Anthropic HTTP 400: … · Gemini HTTP 403: …"), więc dzielimy
 * go na odcinki zaczynające się od „<Dostawca> HTTP <status>".
 */
export function findKeyFailures(message: string): ProviderFailure[] {
  const out: ProviderFailure[] = [];
  const re = /\b(Anthropic|Gemini|Groq) HTTP (\d{3})/gi;
  const hits = [...message.matchAll(re)];
  hits.forEach((m, i) => {
    const provider = SEGMENT_PROVIDER[m[1].toLowerCase()];
    const end = i + 1 < hits.length ? hits[i + 1].index : message.length;
    const segment = message.slice(m.index, end);
    const reason = classifyKeyFailure(provider, Number(m[2]), segment);
    if (reason && !out.some((f) => f.provider === provider)) out.push({ provider, reason });
  });
  return out;
}
