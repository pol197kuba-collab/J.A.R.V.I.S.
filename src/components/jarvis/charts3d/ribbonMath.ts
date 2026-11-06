// Pure math of the 3D ribbon chart (the "data in space" look): domain and nice
// ticks, x/y placement in the chart's world box, nearest session under the
// pointer. No three.js, no DOM.

/** The chart's world box: width along x, height along y (world units). */
export const RIBBON_W = 1000;
export const RIBBON_H = 300;
/** How far the floor grid reaches behind the ribbons. */
export const RIBBON_DEPTH = 150;
/** Spacing of series standing one behind another (index mode). */
export const RIBBON_ROW_GAP = 62;
/** Entrance: the ribbons grow out of the floor. */
export const RIBBON_GROW_MS = 700;

/** Value domain of every point (forecast bands included), padded so nothing touches the edges. */
export function ribbonDomain(values: number[]): { lo: number; hi: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) * 0.05 || 1;
    lo -= d;
    hi += d;
  }
  const pad = (hi - lo) * 0.1;
  return { lo: lo - pad, hi: hi + pad * 1.5 };
}

/** 3–5 round tick values inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** x of row `i` of `n` (rows are the union of all dates, forecast days included). */
export const ribbonX = (i: number, n: number) =>
  n <= 1 ? 0 : -RIBBON_W / 2 + (i / (n - 1)) * RIBBON_W;

/** y of a value in the domain. */
export const ribbonY = (v: number, lo: number, hi: number) =>
  ((v - lo) / (hi - lo || 1)) * RIBBON_H;

/** Index of the screen x closest to `px` (screen positions of the rows, in order). */
export function nearestIndex(screenXs: number[], px: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < screenXs.length; i++) {
    const d = Math.abs(screenXs[i] - px);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Up to `count` evenly spread row indices for the date labels (first and last included). */
export function labelIndices(n: number, count = 6): number[] {
  if (n <= 0) return [];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: count }, (_, k) => Math.round((k / (count - 1)) * (n - 1)));
}

/**
 * Camera distance that fits the plot (and its labels) in a view of `fovDeg` and
 * `aspect`: limited by width on narrow screens, by height on wide ones.
 */
export function ribbonCameraDistance(fovDeg: number, aspect: number, widthScale: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  return Math.max((RIBBON_W * widthScale * 0.6) / tanH, (RIBBON_H * 0.78) / tanV);
}

/** Phones: a narrower, taller ribbon reads better than a flat strip. */
export const ribbonWidthScale = (aspect: number) => (aspect < 1.6 ? 0.58 : 1);
