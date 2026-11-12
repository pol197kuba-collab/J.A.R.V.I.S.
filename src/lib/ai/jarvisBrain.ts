// JARVIS brain — krótkie kwestie i odpowiedzi J.A.R.V.I.S.-a dla głosu i UI.
//
// Plan naprawczy, etap 5 (A8): jedyna droga to serwer (runAgent → Agent
// Runtime). Dawna ścieżka przeglądarkowa wołała Gemini prosto z przeglądarki
// kluczem z localStorage (klucz w adresie żądania i w pamięci przeglądarki) —
// usunięta razem z przełącznikiem trybu czatu. Gdy serwer nie odpowiada,
// zostają gotowe kwestie zastępcze, żeby system nigdy nie zamilkł.

import { setAgentBusy, reportOutcome } from "./agentActivity";
import { logClientEvent } from "@/lib/system/logClientEvent";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { UI_ACTIONS } from "@/lib/constants/uiActions";

// Wiadomość „czy serwer ma klucz Gemini” (tak/nie — nie sekret). Odświeża ją
// useAgentChatChannel i Ustawienia; służy tylko komunikatowi „rdzeń offline”.
const SERVER_KEY_LINKED_LS_KEY = "jarvis_server_gemini_linked";
// Dawne wpisy: klucz Gemini w przeglądarce i tryb czatu. Sprzątane przy starcie.
const STALE_LS_KEYS = ["jarvis_gemini_api_key", "jarvis_chat_routing_server"];

if (typeof window !== "undefined") {
  try {
    STALE_LS_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Conversation continuity for the server-routed path.
//
// Voice and the manual chat input both end up here calling the same
// "jarvis" agent. Without threading a conversationId through, every
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
        const res = await getActiveConversation({ data: { agentSlug: AGENT_SLUGS.JARVIS } });
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

// Action vocabulary shared with the server-side J.A.R.V.I.S. runtime (UI_ACTIONS in
// src/lib/constants/uiActions.ts) plus the client-only "none" escape hatch.
// Sourcing both from the same array is what stops them from drifting
// silently — that drift already shipped twice (system_check shadowing
// S.H.I.E.L.D., PRs #43/#44).
export const JARVIS_ACTIONS = ["none", ...UI_ACTIONS] as const;

export type JarvisAction = (typeof JARVIS_ACTIONS)[number];

export type JarvisReply = { action: JarvisAction; speech: string };

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
  telemetry: ["Sprawdzam dojazd do pracy.", "Kanał Situation Room startuje."],
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
  if (kind === "sleep")
    return { action: "sleep", speech: "Przechodzę w tryb czuwania, Panie Sławiński." };
  return { action: "none", speech: pick(FALLBACK_GENERIC) };
}

export function tryParseJson(text: string): JarvisReply | null {
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

  // Agent Runtime na serwerze. Import dynamiczny, żeby funkcje serwerowe nie
  // ładowały się do każdego bundla, który tylko woła speakJarvis.
  try {
    const { runAgent } = await import("@/lib/agents/runtime.functions");
    const conversationId = await resolveConversationId();
    setAgentBusy(true);
    let result;
    try {
      result = await runAgent({
        data: {
          agentSlug: AGENT_SLUGS.JARVIS,
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
    void logClientEvent(
      "warn",
      "jarvis_brain_client",
      `server runtime returned error: ${result.error ?? "unknown"}`,
      {
        status: result.status,
      },
    );
    return fb();
  } catch (err) {
    reportOutcome("error");
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[brain] server runtime exception", err);
    void logClientEvent("error", "jarvis_brain_client", `server runtime exception: ${msg}`);
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

/** Czy serwer ma klucz Gemini (ostatnia znana wartość) — dla komunikatu „rdzeń offline”. */
export function hasGeminiKey(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SERVER_KEY_LINKED_LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Ustawienia i kanał czatu zapisują tu stan klucza na serwerze. */
export function setServerKeyLinked(linked: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (linked) window.localStorage.setItem(SERVER_KEY_LINKED_LS_KEY, "1");
    else window.localStorage.removeItem(SERVER_KEY_LINKED_LS_KEY);
  } catch {
    /* ignore */
  }
}
