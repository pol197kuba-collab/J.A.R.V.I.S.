// Lightweight global event bus for the Conversation Stream.
// Voice commands, manual chat input, and Jarvis replies all publish here
// so the ChatPanel can render a unified, persistent transcript.

export type ChatBusMessage = {
  id: string;
  role: "user" | "jarvis";
  text: string;
  time: string;
};

const EVENT = "jarvis:chat";

function now() {
  return new Date().toTimeString().slice(0, 8);
}

export function emitChat(role: ChatBusMessage["role"], text: string) {
  if (typeof window === "undefined") return;
  if (!text || !text.trim()) return;
  const msg: ChatBusMessage = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    role,
    text: text.trim(),
    time: now(),
  };
  window.dispatchEvent(new CustomEvent<ChatBusMessage>(EVENT, { detail: msg }));
}

export function onChat(handler: (msg: ChatBusMessage) => void) {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => handler((e as CustomEvent<ChatBusMessage>).detail);
  window.addEventListener(EVENT, fn as EventListener);
  return () => window.removeEventListener(EVENT, fn as EventListener);
}

// ---------------------------------------------------------------------------
// Conversation memory helper.
// Reads the same localStorage bucket the ChatPanel persists into and returns
// the last `n` clean user/jarvis turns so VoiceCommandContext can feed them
// into Gemini as multi-turn context. Filters out anything that looks like a
// raw JSON envelope from the system pipeline ({"action":..,"speech":..}) so
// the model never sees its own protocol leaking back as conversation.
const HISTORY_KEY = "jarvis_chat_history";

function looksLikeJsonEnvelope(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return false;
  return /"action"\s*:/.test(t) && /"speech"\s*:/.test(t);
}

export function getRecentHistory(
  n = 10,
): Array<{ role: "user" | "jarvis"; text: string }> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as ChatBusMessage[];
    if (!Array.isArray(items)) return [];
    const clean = items
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "jarvis") &&
          typeof m.text === "string" &&
          m.text.trim().length > 0 &&
          !looksLikeJsonEnvelope(m.text),
      )
      .map((m) => ({ role: m.role, text: m.text.trim() }));
    return clean.slice(-n);
  } catch {
    return [];
  }
}