// Local safety-net phrase matcher for Protocol: Ark Reboot.
// Used by both the chat input and the voice pipeline so the reboot
// sequence fires instantly without burning a Gemini call.

export const REBOOT_PHRASE_RE =
  /\b(ark\s+reboot|reboot\s+system|restart\s+system|zrestartuj\s+system|zresetuj\s+system|reboot|restart|reset)\b/i;

export function matchesReboot(text: string): boolean {
  if (!text) return false;
  return REBOOT_PHRASE_RE.test(text.trim());
}
