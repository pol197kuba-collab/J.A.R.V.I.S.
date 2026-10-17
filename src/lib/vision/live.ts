// Vision AR (S4.3) — live mode. Pure: the model's boxes made safe, a cheap
// "did the picture change?" check (so a still camera costs nothing), and
// mapping a box from the camera frame onto the on-screen video, which is
// object-fit: cover (cropped to fill its box).

/** One frame every this many ms while live. */
export const LIVE_INTERVAL_MS = 3000;
/** Live mode switches itself off after this long — every frame is a paid call. */
export const LIVE_MAX_MS = 60_000;
/** Longest side of a live frame: boxes need far fewer pixels than reading text. */
export const LIVE_FRAME_SIDE = 640;
/** Side of the grey thumbnail compared between frames. */
export const DIFF_SIDE = 16;
/** Mean absolute difference (0–255) below which the scene counts as unchanged. */
export const DIFF_THRESHOLD = 6;
export const MAX_DETECTIONS = 8;

export type Detection = {
  label: string;
  /** Normalised 0–1 in the camera frame. */
  x: number;
  y: number;
  w: number;
  h: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Gemini's boxes come as `box_2d: [ymin, xmin, ymax, xmax]` on a 0–1000
 * grid. Anything malformed, empty or tiny is dropped; the biggest objects
 * come first and the list is capped.
 */
export function normalizeDetections(raw: unknown): Detection[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { objects?: unknown }).objects)
      ? (raw as { objects: unknown[] }).objects
      : [];
  const out: Detection[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const o = it as { label?: unknown; box_2d?: unknown };
    const label =
      typeof o.label === "string" ? o.label.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    const b = Array.isArray(o.box_2d) ? o.box_2d.map(Number) : [];
    if (!label || b.length !== 4 || b.some((v) => !Number.isFinite(v))) continue;
    const [y0, x0, y1, x1] = b.map((v) => clamp01(v / 1000));
    const x = Math.min(x0, x1),
      y = Math.min(y0, y1),
      w = Math.abs(x1 - x0),
      h = Math.abs(y1 - y0);
    if (w < 0.02 || h < 0.02) continue;
    out.push({ label, x, y, w, h });
  }
  return out.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_DETECTIONS);
}

/** Mean absolute difference of two equal-length grey thumbnails (0–255). */
export function frameDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** RGBA pixels → grey values (Rec. 601 luma). */
export function toGrey(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++)
    out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  return out;
}

/**
 * A normalised box in the camera frame → CSS px in a box of `viewW × viewH`
 * showing that frame with object-fit: cover (scaled to fill, centred,
 * overflow cropped). Boxes partly off-screen are clipped to the view;
 * fully off-screen ones return null.
 */
export function coverRect(
  d: Pick<Detection, "x" | "y" | "w" | "h">,
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
): { left: number; top: number; width: number; height: number } | null {
  if (frameW <= 0 || frameH <= 0 || viewW <= 0 || viewH <= 0) return null;
  const s = Math.max(viewW / frameW, viewH / frameH);
  const offX = (viewW - frameW * s) / 2;
  const offY = (viewH - frameH * s) / 2;
  const l = offX + d.x * frameW * s,
    t = offY + d.y * frameH * s;
  const r = l + d.w * frameW * s,
    b = t + d.h * frameH * s;
  const cl = Math.max(0, l),
    ct = Math.max(0, t),
    cr = Math.min(viewW, r),
    cb = Math.min(viewH, b);
  if (cr - cl < 4 || cb - ct < 4) return null;
  return { left: cl, top: ct, width: cr - cl, height: cb - ct };
}

/** The frame region to crop for "what is this?", with a margin, in px. */
export function cropRect(
  d: Pick<Detection, "x" | "y" | "w" | "h">,
  frameW: number,
  frameH: number,
  margin = 0.15,
): { sx: number; sy: number; sw: number; sh: number } {
  const mx = d.w * margin,
    my = d.h * margin;
  const x0 = clamp01(d.x - mx),
    y0 = clamp01(d.y - my);
  const x1 = clamp01(d.x + d.w + mx),
    y1 = clamp01(d.y + d.h + my);
  return {
    sx: Math.round(x0 * frameW),
    sy: Math.round(y0 * frameH),
    sw: Math.max(1, Math.round((x1 - x0) * frameW)),
    sh: Math.max(1, Math.round((y1 - y0) * frameH)),
  };
}
