// Client-side counterpart to logServerError — for code paths that never
// reach a server function at all (the client-only Gemini fallback in
// jarvisBrain.ts, voice engine errors in VoiceCommandContext.tsx/speak.ts)
// and would otherwise leave zero trace in system_events for Guardian to
// ever find, no matter how good its analysis tools get.
//
// Calls the existing (previously unused anywhere in the app) emitSystemEvent
// server function directly — same pattern jarvisBrain.ts already uses for
// runAgent (a plain dynamic import + direct call, no useServerFn needed
// outside a React render). Best-effort: swallows its own failures, since a
// logging call must never break the user-facing flow it's describing.

export async function logClientEvent(
  level: "warn" | "error",
  source: string,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const { emitSystemEvent } = await import("@/lib/system/events.functions");
    await emitSystemEvent({ data: { level, source, message, meta } });
  } catch {
    /* best-effort — never let logging itself break the caller */
  }
}
