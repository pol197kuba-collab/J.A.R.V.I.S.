// App-wide UI mode: "hud" (the classic J.A.R.V.I.S. look) or "town" (the
// Agent Town pixel-RPG look). A mode is a theme plus a home view: switching
// sets data-theme on <html> — every module reskins through the theme tokens
// in src/styles.css — and the switch control then opens that mode's home.
//
// Stored per device in localStorage. UI_MODE_BOOT_SCRIPT applies the stored
// mode before first paint, so a Town user never sees a flash of HUD cyan.

import { useSyncExternalStore } from "react";

export type UiMode = "hud" | "town";
export type StartMode = "last" | UiMode;

export const UI_MODE_KEY = "jarvis.uiMode";
export const UI_START_MODE_KEY = "jarvis.uiStartMode";

export const MODE_HOME: Record<UiMode, string> = { hud: "/jarvis", town: "/town" };
export const THEME_FOR_MODE: Record<UiMode, string> = { hud: "jarvis", town: "town" };

const isMode = (v: unknown): v is UiMode => v === "hud" || v === "town";
const isStartMode = (v: unknown): v is StartMode => v === "last" || isMode(v);

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the mode still applies for this session */
  }
}

/** The mode a fresh session should open in, honouring the start-mode setting. */
export function resolveStartMode(startMode: string | null, lastMode: string | null): UiMode {
  if (isMode(startMode)) return startMode;
  return isMode(lastMode) ? lastMode : "hud";
}

let current: UiMode =
  typeof window === "undefined"
    ? "hud"
    : resolveStartMode(readLocal(UI_START_MODE_KEY), readLocal(UI_MODE_KEY));
const listeners = new Set<() => void>();

function applyToDocument(mode: UiMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", THEME_FOR_MODE[mode]);
}

export function getUiMode(): UiMode {
  return current;
}

export function setUiMode(mode: UiMode) {
  writeLocal(UI_MODE_KEY, mode);
  if (mode === current) {
    applyToDocument(mode);
    return;
  }
  current = mode;
  applyToDocument(mode);
  for (const l of listeners) l();
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "hud",
  );
}

export function getStartMode(): StartMode {
  const v = typeof window === "undefined" ? null : readLocal(UI_START_MODE_KEY);
  return isStartMode(v) ? v : "last";
}

export function setStartMode(mode: StartMode) {
  writeLocal(UI_START_MODE_KEY, mode);
}

/** Inline <head> script: same resolution as resolveStartMode, run before paint. */
export const UI_MODE_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  UI_START_MODE_KEY,
)});var m=(s==="hud"||s==="town")?s:localStorage.getItem(${JSON.stringify(
  UI_MODE_KEY,
)});document.documentElement.setAttribute("data-theme",m==="town"?"town":"jarvis")}catch(e){}})();`;
