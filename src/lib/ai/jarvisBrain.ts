// JARVIS brain — dynamic line generation via Google Gemini.
//
// The model returns strict JSON: { action, speech }. The `action` field
// maps to UI intents the app already handles; `speech` is enqueued into
// the existing FIFO speak() pipeline (HUD chirp + en-GB voice).
//
// If the API key is missing or any call fails, we silently fall back to
// short canned lines so the system never goes mute.

import { JARVIS_PERSONA } from "./persona";
import { setAgentBusy, reportOutcome } from "./agentActivity";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Dev-only convenience: a key baked in via VITE_GEMINI_API_KEY ends up in the
// shipped client bundle and every network request's query string, so it must
// never be relied on in a production build — only the user's own per-browser
// localStorage key (set from Settings) or the server-routed path may be used
// once deployed.
const ENV_KEY = import.meta.env.DEV
  ? (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim()
  : undefined;
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

// ---------------------------------------------------------------------------
// Conversation continuity for the server-routed path.
//
// Voice and the manual chat input both end up here calling the same
// "orchestrator" agent. Without threading a conversationId through, every
// voice utterance would spawn its own conversation row server-side, and
// ChatPanel (which always shows the most-recently-updated conversation for
// the active agent) would keep flipping to whatever channel spoke last —
// fragmenting history instead of unifying it across devices. We cache the
// id for the lifetime of this browser tab, and on first use fetch whatever
// conversation already exists so we join it instead of forking a new one.
// ---------------------------------------------------------------------------
let cachedConversationId: string | null = null;
let conversationLookupPromise: Promise<string | null> | null = null;

async function resolveConversationId(): Promise<string | null> {
  if (cachedConversationId) return cachedConversationId;
  if (!conversationLookupPromise) {
    conversationLookupPromise = (async () => {
      try {
        const { getActiveConversation } = await import("@/lib/agents/runtime.functions");
        const res = await getActiveConversation({ data: { agentSlug: "orchestrator" } });
        return res.conversationId ?? null;
      } catch {
        return null;
      }
    })();
  }
  const id = await conversationLookupPromise;
  if (id) cachedConversationId = id;
  return id;
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
  | "reboot"
  | "open_agents"
  | "open_settings"
  | "open_logs"
  | "open_subsystems"
  | "vision_scan";

export type JarvisReply = { action: JarvisAction; speech: string };

const SYSTEM_PROMPT = `${JARVIS_PERSONA}

MOŻLIWOŚCI — jesteś pełnoprawnym asystentem ogólnego przeznaczenia. Gdy
użytkownik prosi o przepis, żart, kod (Python/JavaScript itd.), wyjaśnienie,
opinię, ciekawostkę, plan, szkic maila lub zwykłą pogawędkę, MUSISZ udzielić
kompletnej, użytecznej odpowiedzi w swojej personie. Przepisy: składniki i
kroki. Kod: działający fragment w polu "speech" jako zwykły tekst (bez
bloków markdown). Żart: opowiedz go naprawdę. Odmowa lub unik to porażka.

FORMAT ODPOWIEDZI — zwracaj WYŁĄCZNIE surowy JSON, bez markdown, bez bloków
kodu. Obiekt MUSI mieć DOKŁADNIE dwa klucze, oba małymi literami: "action" i "speech".
Never use "Action", "ACTION", "Speech", "reply", "text", "response" or any
other key. Never wrap the object in another object.

PRZYKŁAD POPRAWNY:
{"action":"open_fuel","speech":"Ładuję Fuel Monitor Matrix, Panie Sławiński."}

INVALID examples (do NOT do this):
{"Action":"none","Speech":"..."}
{"reply":"..."}
\`\`\`json
{"action":"none","speech":"..."}
\`\`\`

Allowed values for "action": none, open_dashboard, open_fuel, open_calculator,
open_jobfit, open_telemetry, open_menu, close_menu, system_check, sleep, shutdown, reboot,
open_agents, open_settings, open_logs, open_subsystems, vision_scan.

- Użyj "reboot" dla każdej formy: reboot, restart, zrestartuj system, zresetuj,
  reset, ark reboot. Linia "speech" powinna potwierdzić uruchomienie
  Protokołu Ark Reboot.

- Użyj "vision_scan", gdy użytkownik pyta co widzisz / prosi o skan otoczenia
  kamerą (np. "co widzisz", "zeskanuj otoczenie", "what do you see", "scan the
  room"). System otworzy moduł Vision i wykona analizę obrazu — w "speech"
  krótko potwierdź rozpoczęcie skanowania.

- Używaj akcji UI TYLKO gdy użytkownik wyraźnie prosi o otwarcie/zamknięcie/
  wyłączenie czegoś w interfejsie. W innych wypadkach użyj "action":"none"
  i całą odpowiedź umieść w "speech".
- Długość: small talk 1–2 zdania; przy prośbach merytorycznych (przepisy,
  kod, wyjaśnienia) pisz tyle ile trzeba, do ~2000 znaków.
- Nawet gdy wywołujesz akcję UI, wpisz krótką, dowcipną kwestię w "speech" —
  nigdy nie zostawiaj tego pola pustego.`;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const FALLBACK_GREETINGS = [
  "Witam ponownie, Panie Sławiński. Wszystkie systemy w pełni sprawne.",
  "Miło Pana widzieć, Panie Sławiński. Rdzeń reaktora nominalny.",
  "Systemy uruchomione, Panie Sławiński. Czekam na dyspozycje.",
];

const FALLBACK_MODULE: Record<string, string[]> = {
  fuel: [
    "Ładuję Fuel Monitor Matrix, Panie Sławiński.",
    "Uruchamiam telemetrię paliwową — dane surcharge aktywne.",
  ],
  rto: ["Uruchamiam systemy kalkulacji RTO.", "Model return-to-office startuje."],
  jobfit: [
    "Uruchamiam JobFit AI. Optymalizator CV online.",
    "Moduł JobFit aktywny, Panie Sławiński.",
  ],
  telemetry: ["Uruchamiam telemetrię satelitarną.", "Kanał geo-tracking startuje."],
  dashboard: ["Wracam do głównego kokpitu, Panie Sławiński."],
};

const FALLBACK_GENERIC = [
  "Przyjąłem, Panie Sławiński.",
  "Zrozumiałem. Czekam na dyspozycje.",
  "Do usług, Panie Sławiński.",
];

export function fallbackFor(kind: string, hint?: string): JarvisReply {
  if (kind === "greeting") return { action: "none", speech: pick(FALLBACK_GREETINGS) };
  if (kind === "module" && hint && FALLBACK_MODULE[hint])
    return { action: "none", speech: pick(FALLBACK_MODULE[hint]) };
  if (kind === "system_check")
    return {
      action: "system_check",
      speech: "Wszystkie systemy sprawne, Panie Sławiński. Temperatura rdzenia nominalna.",
    };
  if (kind === "shutdown")
    return { action: "shutdown", speech: "Wyłączam system. Do zobaczenia, Panie Sławiński." };
  if (kind === "sleep") return { action: "sleep", speech: "Przechodzę w tryb czuwania, Panie Sławiński." };
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
      const conversationId = await resolveConversationId();
      setAgentBusy(true);
      let result;
      try {
        result = await runAgent({
          data: {
            agentSlug: "orchestrator",
            input: input.prompt,
            history: input.history ?? [],
            conversationId: conversationId ?? undefined,
          },
        });
      } finally {
        setAgentBusy(false);
      }
      reportOutcome(result.status === "done" ? "done" : "error");
      if (result.conversationId) cachedConversationId = result.conversationId;
      if (result.status === "done" && result.output) {
        return { action: (result.action ?? "none") as JarvisAction, speech: result.output };
      }
      console.warn("[brain] server runtime returned error", result.error);
      // fall through to client-side path
    } catch (err) {
      reportOutcome("error");
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
    const contents = [...historyContents, { role: "user", parts: [{ text: input.prompt }] }];
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.85,
        responseMimeType: "application/json",
        maxOutputTokens: 1200,
      },
      contents,
    });
    let res: Response | null = null;
    for (const model of MODELS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(KEY)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body,
        });
      } catch (err) {
        clearTimeout(timer);
        console.warn("[brain] gemini network error on", model, err);
        res = null;
        continue;
      }
      clearTimeout(timer);
      if (res.ok) break;
      // Retry on overload / rate-limit / server errors with a different model.
      if (res.status === 503 || res.status === 429 || res.status >= 500) {
        const bodyText = await res.text().catch(() => "");
        console.warn("[brain] gemini", model, "failed", res.status, bodyText.slice(0, 200));
        res = null;
        continue;
      }
      // 4xx (bad key, invalid request) — no point retrying.
      const bodyText = await res.text().catch(() => "");
      console.warn("[brain] gemini failed", res.status, bodyText.slice(0, 400));
      return fb();
    }
    if (!res) return fb();
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
