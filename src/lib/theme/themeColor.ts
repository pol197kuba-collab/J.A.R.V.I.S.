// Theme tokens for code that can't read CSS custom properties itself —
// three.js materials/lights and <canvas> 2D strokes take a concrete color,
// not `var(--primary)`. These helpers resolve any CSS color expression
// (`var(--primary)`, `color-mix(in oklab, var(--reactor) 25%, black)`, …)
// against the live document into a "#rrggbb" hex, and re-resolve when the
// theme on <html> changes, so the 3D scene follows the active theme like
// the rest of the UI does.

import { useEffect, useState } from "react";

let probe: HTMLSpanElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;

/** Resolve a CSS color expression to "#rrggbb" in the current theme.
 *  Returns `fallback` during SSR or if the browser can't resolve it. */
export function resolveCssColor(expr: string, fallback = "#000000"): string {
  if (typeof document === "undefined") return fallback;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.display = "none";
    document.documentElement.appendChild(probe);
  }
  if (!ctx2d) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    ctx2d = c.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx2d) return fallback;

  // Let CSS resolve var()/color-mix() via a probe element on <html>, then
  // paint the computed color (which may still be oklch()/color() syntax) to
  // a 1px canvas and read the sRGB pixel back — the one conversion path
  // every browser shares.
  probe.style.color = "";
  probe.style.color = expr;
  const computed = getComputedStyle(probe).color;
  if (!computed) return fallback;
  ctx2d.clearRect(0, 0, 1, 1);
  ctx2d.fillStyle = "#000";
  ctx2d.fillStyle = computed;
  ctx2d.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** "#rrggbb" + alpha → "rgba(r, g, b, a)" for canvas strokes/shadows. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function resolveAll<K extends string>(
  spec: Record<K, string>,
  fallbacks: Record<K, string>,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(spec) as K[]) out[k] = resolveCssColor(spec[k], fallbacks[k]);
  return out;
}

/**
 * Resolve a fixed set of theme color expressions to hex, re-resolving when
 * <html>'s `data-theme`/`class`/`style` changes. `spec` and `fallbacks`
 * must be module-level constants (they're read once per theme change, not
 * tracked as dependencies). Fallbacks are what SSR and the first client
 * render use, so they should match the default theme.
 */
export function useThemeColors<K extends string>(
  spec: Record<K, string>,
  fallbacks: Record<K, string>,
): Record<K, string> {
  const [colors, setColors] = useState(fallbacks);

  useEffect(() => {
    const update = () => setColors(resolveAll(spec, fallbacks));
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    return () => mo.disconnect();
    // spec/fallbacks are module-level constants by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return colors;
}
