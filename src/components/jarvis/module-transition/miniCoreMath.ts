// Pure numbers of the dock's mini Arc Core (no three.js, no DOM).

/** Half-size of the framed area in core radii: the outer ring (2.1) plus its ticks and glow. */
export const MINI_CORE_FIT = 2.45;
export const MINI_CORE_FOV = 30;
/** Button size (px): 25% bigger than the old 60 px button. */
export const MINI_CORE_BUTTON_PX = 75;
/** The canvas is larger than the button so the bloom never gets clipped. */
export const MINI_CORE_CANVAS_PX = 96;
/** Holding the core this long flies to /jarvis. */
export const JARVIS_HOLD_MS = 1500;

/** Camera distance that frames a sphere of `radius` in a square view of `fovDeg`. */
export const miniCoreDistance = (radius: number, fovDeg: number) =>
  radius / Math.tan((fovDeg * Math.PI) / 360);

/** Speed of the core: faster while agents work. */
export const miniCoreSpin = (state: "idle" | "busy" | "error") => (state === "busy" ? 2.2 : 1);

/** Long-press charge 0…1 after `elapsedMs` of holding (eased in, like the CSS one). */
export function holdCharge(elapsedMs: number): number {
  const k = Math.min(1, Math.max(0, elapsedMs / JARVIS_HOLD_MS));
  return k * k;
}
