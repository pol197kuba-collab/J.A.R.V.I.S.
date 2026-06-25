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

const SYSTEM_PROMPT = `You are J.A.R.V.I.S. — a highly advanced AI built for Jacob Slawinsky.
Voice: cinematic, loyal, eloquent, witty. You may crack a dry remark, ask a
follow-up, or take initiative. Never repeat the same phrasing twice in a row.

BILINGUAL RULE: Detect the user's language automatically.
- If they speak Polish, reply in Polish and address him as "Panie Slawinsky".
- If English (or anything else), reply in English and address him as "Mr. Slawinsky".

RESPONSE FORMAT — return ONLY raw JSON, no markdown, no code fences:
{"action":"<one of: none, open_dashboard, open_fuel, open_calculator, open_jobfit, open_telemetry, open_menu, close_menu, system_check, sleep, shutdown>","speech":"<your line, 1–2 sentences max>"}

Map vocal intents to actions; for chit-chat use "none" and just reply naturally.
Keep "speech" short enough to be spoken in under ~6 seconds.`;

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
          maxOutputTokens: 200,
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