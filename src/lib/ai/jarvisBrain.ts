// JARVIS brain — dynamic line generation via Google Gemini.
//
// The model returns strict JSON: { action, speech }. The `action` field
// maps to UI intents the app already handles; `speech` is enqueued into
// the existing FIFO speak() pipeline (HUD chirp + en-GB voice).
//
// If the API key is missing or any call fails, we silently fall back to
// short canned lines so the system never goes mute.

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const ENV_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
const LS_KEY = "jarvis_gemini_api_key";
// Cached mirror of user_settings.chat_routing so we can decide sync in the
// hot path. Kept in sync by Settings page whenever the user toggles it.
const SERVER_ROUTING_LS_KEY = "jarvis_chat_routing_server";
// Cached mirror of "server has Gemini key" — set by Settings page after a
// successful saveGeminiKey call. Lets us fall back gracefully if the server
// key was cleared.
const SERVER_KEY_LINKED_LS_KEY = "jarvis_server_gemini_linked";

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

function shouldUseServerRuntime(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(SERVER_ROUTING_LS_KEY) === "1" &&
      window.localStorage.getItem(SERVER_KEY_LINKED_LS_KEY) === "1"
    );
  } catch {
    return false;
  }
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
  | "shutdown"
  | "reboot";

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

RESPONSE FORMAT — return ONLY raw JSON, no markdown, no code fences. The
object MUST have EXACTLY two keys, both lowercase: "action" and "speech".
Never use "Action", "ACTION", "Speech", "reply", "text", "response" or any
other key. Never wrap the object in another object.

VALID example:
{"action":"open_fuel","speech":"Loading the Fuel Monitor matrix, Sir."}

INVALID examples (do NOT do this):
{"Action":"none","Speech":"..."}
{"reply":"..."}
\`\`\`json
{"action":"none","speech":"..."}
\`\`\`

Allowed values for "action": none, open_dashboard, open_fuel, open_calculator,
open_jobfit, open_telemetry, open_menu, close_menu, system_check, sleep, shutdown, reboot.

- Use "reboot" for any phrasing of: reboot, restart, restart system, reboot system,
  zrestartuj system, zresetuj, reset, ark reboot. Speech line should acknowledge
  engaging Protocol: Ark Reboot.

- Use a UI action ONLY when the user clearly asks to open/close/shut down
  something in the interface. Otherwise use "action":"none" and put the entire
  answer in "speech".
- Length: keep small talk to 1–2 sentences; for substantive requests
  (recipes, code, explanations) write as much as needed, up to ~2000 characters.
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
    // Tolerate stray uppercase / synonym keys from a misbehaving model.
    const speechRaw =
      obj?.speech ?? obj?.Speech ?? obj?.SPEECH ?? obj?.reply ?? obj?.text ?? obj?.response;
    if (typeof speechRaw !== "string") return null;
    const actionRaw = obj?.action ?? obj?.Action ?? obj?.ACTION ?? "none";
    const action: JarvisAction = String(actionRaw).toLowerCase() as JarvisAction;
    return { action, speech: speechRaw };
  } catch {
    return null;
  }
}

export type BrainInput = {
  /** Free-form context: user transcript, UI event, or system note. */
  prompt: string;
  /** Where the prompt originated — lets the model calibrate length/tone. */
  source?: "voice" | "chat" | "system";
  /** Recent clean conversation turns for multi-turn memory. */
  history?: Array<{ role: "user" | "jarvis"; text: string }>;
  /** Used by fallbackFor() if the network call fails. */
  fallbackKind?: "greeting" | "module" | "system_check" | "shutdown" | "sleep" | "generic";
  fallbackHint?: string;
};

export async function askJarvis(input: BrainInput): Promise<JarvisReply> {
  const fb = () => fallbackFor(input.fallbackKind ?? "generic", input.fallbackHint);

  // Server routing (Agent Runtime). Dynamically imported so the server
  // function's server-only helpers don't pull into every bundle unless used.
  if (shouldUseServerRuntime()) {
    try {
      const { runAgent } = await import("@/lib/agents/runtime.functions");
      const result = await runAgent({
        data: {
          agentSlug: "orchestrator",
          input: input.prompt,
          history: input.history ?? [],
        },
      });
      if (result.status === "done" && result.output) {
        return { action: "none", speech: result.output };
      }
      console.warn("[brain] server runtime returned error", result.error);
      // fall through to client-side path
    } catch (err) {
      console.warn("[brain] server runtime exception", err);
      // fall through to client-side path
    }
  }

  const KEY = getKey();
  if (!KEY) return fb();

  try {
    const historyContents = (input.history ?? [])
      .filter((h) => h && typeof h.text === "string" && h.text.trim())
      .map((h) => ({
        role: h.role === "jarvis" ? "model" : "user",
        parts: [{ text: h.text }],
      }));
    const contents = [
      ...historyContents,
      { role: "user", parts: [{ text: input.prompt }] },
    ];
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
          maxOutputTokens: 1200,
        },
        contents,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn("[brain] gemini failed", res.status, bodyText.slice(0, 400));
      return fb();
    }
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn("[brain] gemini empty candidate", JSON.stringify(data).slice(0, 400));
      return fb();
    }
    const parsed = tryParseJson(text);
    if (parsed) {
      console.debug("[brain] reply", parsed);
      return parsed;
    }
    // Plain-text response (model ignored JSON mode for a long answer). Treat
    // the whole body as a spoken reply rather than dropping to "Standing by."
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      console.warn("[brain] parse failed, using raw text", trimmed.slice(0, 200));
      return { action: "none", speech: trimmed };
    }
    return fb();
  } catch (err) {
    console.warn("[brain] gemini exception", err);
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

// Exported so the Settings page can flip the cached flags after DB writes.
export function setServerRuntimePreference(opts: {
  routing: "client" | "server";
  keyLinked: boolean;
}) {
  if (typeof window === "undefined") return;
  try {
    if (opts.routing === "server") {
      window.localStorage.setItem(SERVER_ROUTING_LS_KEY, "1");
    } else {
      window.localStorage.removeItem(SERVER_ROUTING_LS_KEY);
    }
    if (opts.keyLinked) {
      window.localStorage.setItem(SERVER_KEY_LINKED_LS_KEY, "1");
    } else {
      window.localStorage.removeItem(SERVER_KEY_LINKED_LS_KEY);
    }
  } catch {
    /* ignore */
  }
}