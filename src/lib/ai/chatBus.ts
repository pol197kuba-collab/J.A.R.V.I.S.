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