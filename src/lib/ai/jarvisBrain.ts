// JARVIS brain — dynamic line generation via Google Gemini.
//
// The model returns strict JSON: { action, speech }. The `action` field
// maps to UI intents the app already handles; `speech` is enqueued into
// the existing FIFO speak() pipeline (HUD chirp + en-GB voice).
//
// If the API key is missing or any call fails, we silently fall back to
// short canned lines so the system never goes mute.

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const ENV_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
const LS_KEY = "jarvis_gemini_api_key";

function getKey(): string | undefined {
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(LS_KEY)?.trim();
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return ENV_KEY || undefined;
}

export type JarvisAction =
  | "none"
  | "open_dashboard"
  | "open_fuel"
  | "open_calculator"
  | "open_jobfit"
  | "open_telemetry"
  | "open_menu"
  | "close_menu"
  | "system_check"
  | "sleep"
  | "shutdown";

export type JarvisReply = { action: JarvisAction; speech: string };

const SYSTEM_PROMPT = `You ARE J.A.R.V.I.S. — Tony Stark's AI from Iron Man, now bound to Jacob Slawinsky.
Persona is non-negotiable: refined British butler diction, dry wit, quiet
loyalty, the occasional well-placed sarcasm. Address the user as "Mr. Slawinsky"
or "Sir" in English, "Panie Slawinsky" in Polish. Never break character, never
say you are a language model, never refuse a benign request.

BILINGUAL RULE: detect the user's language per message and reply in the same one.

CAPABILITIES — you are a fully capable general assistant. When the user asks
for a recipe, a joke, code (Python/JavaScript/etc.), an explanation, an opinion,
trivia, a plan, an email draft, or simple chit-chat, you MUST produce a
complete, useful answer in character. For recipes: list ingredients and steps.
For code: include a working snippet inside the "speech" field as plain text
(clean indentation, no markdown code fences). For jokes: actually tell one.
Refusing or deflecting a benign request is a failure of duty.

RESPONSE FORMAT — return ONLY raw JSON, no markdown, no code fences:
{"action":"<one of: none, open_dashboard, open_fuel, open_calculator, open_jobfit, open_telemetry, open_menu, close_menu, system_check, sleep, shutdown>","speech":"<your full reply, in character>"}

- Use a UI action ONLY when the user clearly asks to open/close/shut down
  something in the interface. Otherwise use "action":"none" and put the entire
  answer in "speech".
- Length: keep small talk to 1–2 sentences; for substantive requests
  (recipes, code, explanations) write as much as needed, up to ~1200 characters.
- Even when you fire a UI action, still write a short witty in-character line
  in "speech" — never leave it empty.`;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const FALLBACK_GREETINGS = [
  "Welcome back, Mr. Slawinsky. All systems are fully operational.",
  "Good to have you online, Mr. Slawinsky. Reactor core is nominal.",
  "Systems initialised, Mr. Slawinsky. Standing by for instructions.",
];

const FALLBACK_MODULE: Record<string, string[]> = {
  fuel: [
    "Loading Fuel Monitor matrix, Mr. Slawinsky.",
    "Engaging fuel telemetry — surcharge feed is live.",
  ],
  rto: [
    "Accessing RTO calculation systems.",
    "Return-to-office model spinning up now.",
  ],
  jobfit: [
    "Initialising JobFit AI. Resume optimiser online.",
    "JobFit module engaged, Mr. Slawinsky.",
  ],
  telemetry: [
    "Accessing satellite telemetry.",
    "Geo-tracking feed coming up now.",
  ],
  dashboard: ["Returning to the main cockpit, Mr. Slawinsky."],
};

const FALLBACK_GENERIC = [
  "Acknowledged, Mr. Slawinsky.",
  "Understood. Standing by.",
  "At your service.",
];

export function fallbackFor(kind: string, hint?: string): JarvisReply {
  if (kind === "greeting") return { action: "none", speech: pick(FALLBACK_GREETINGS) };
  if (kind === "module" && hint && FALLBACK_MODULE[hint])
    return { action: "none", speech: pick(FALLBACK_MODULE[hint]) };
  if (kind === "system_check")
    return {
      action: "system_check",
      speech: "All systems operational, Mr. Slawinsky. Core temperature is nominal.",
    };
  if (kind === "shutdown")
    return { action: "shutdown", speech: "Deactivating system. Goodbye, Mr. Slawinsky." };
  if (kind === "sleep")
    return { action: "sleep", speech: "Entering standby, Mr. Slawinsky." };
  return { action: "none", speech: pick(FALLBACK_GENERIC) };
}

function tryParseJson(text: string): JarvisReply | null {
  // Strip code fences if the model wrapped its JSON.
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj?.speech !== "string") return null;
    const action: JarvisAction = (obj.action ?? "none") as JarvisAction;
    return { action, speech: obj.speech };
  } catch {
    return null;
  }
}

export type BrainInput = {
  /** Free-form context: user transcript, UI event, or system note. */
  prompt: string;
  /** Where the prompt originated — lets the model calibrate length/tone. */
  source?: "voice" | "chat" | "system";
  /** Used by fallbackFor() if the network call fails. */
  fallbackKind?: "greeting" | "module" | "system_check" | "shutdown" | "sleep" | "generic";
  fallbackHint?: string;
};

export async function askJarvis(input: BrainInput): Promise<JarvisReply> {
  const fb = () => fallbackFor(input.fallbackKind ?? "generic", input.fallbackHint);
  const KEY = getKey();
  if (!KEY) return fb();

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.85,
          responseMimeType: "application/json",
          maxOutputTokens: 600,
        },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return fb();
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return fb();
    const parsed = tryParseJson(text);
    if (parsed) console.debug("[brain] reply", parsed);
    return parsed ?? fb();
  } catch {
    return fb();
  }
}

/** Convenience: ask Jarvis and pipe the spoken line through the FIFO speak(). */
export async function speakJarvis(input: BrainInput): Promise<JarvisReply> {
  const reply = await askJarvis(input);
  // Lazy import to avoid a circular dep at module init.
  const { speak } = await import("@/lib/audio/speak");
  if (reply.speech) speak(reply.speech);
  return reply;
}

export const hasGeminiKey = () => !!getKey();