// Agent-activity pub-sub — mirrors the shape of onSpeaking/isSpeakingNow
// in @/lib/audio/speak. Tracks whether an agent call is currently in flight
// ("working" state) and emits one-shot outcome pings for success/error.

const BUSY_EVENT = "jarvis:agent-busy";
const OUTCOME_EVENT = "jarvis:agent-outcome";

let busyCount = 0;

export function setAgentBusy(busy: boolean) {
  if (typeof window === "undefined") return;
  busyCount = Math.max(0, busyCount + (busy ? 1 : -1));
  const active = busyCount > 0;
  window.dispatchEvent(new CustomEvent(BUSY_EVENT, { detail: active }));
}

export function onAgentBusy(handler: (active: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => handler((e as CustomEvent<boolean>).detail);
  window.addEventListener(BUSY_EVENT, fn as EventListener);
  return () => window.removeEventListener(BUSY_EVENT, fn as EventListener);
}

export function isAgentBusyNow() {
  return busyCount > 0;
}

export type AgentOutcome = "done" | "error";

export function reportOutcome(status: AgentOutcome) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTCOME_EVENT, { detail: status }));
}

export function onOutcome(handler: (status: AgentOutcome) => void) {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => handler((e as CustomEvent<AgentOutcome>).detail);
  window.addEventListener(OUTCOME_EVENT, fn as EventListener);
  return () => window.removeEventListener(OUTCOME_EVENT, fn as EventListener);
}