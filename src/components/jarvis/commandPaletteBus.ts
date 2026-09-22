/**
 * Tiny event bus for opening the command palette from anywhere.
 *
 * The palette lives in DashboardShell, but the triggers that open it sit in
 * unrelated subtrees (the sidebar's search row, the header's SYS button,
 * potentially a voice command). A window event keeps them from having to
 * thread a callback through the whole chrome — and matches how the existing
 * "jarvis:sidebar" voice bridge already talks to the shell.
 */
const EVENT = "jarvis:command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onOpenCommandPalette(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
