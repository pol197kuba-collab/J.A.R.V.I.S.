// "Battle transition" between UI modes: the screen fills with pixel blocks
// from the centre outwards, `swap` runs while it's fully covered (so the
// theme change and route change happen out of sight), then the blocks clear.
// Plain DOM — no React — so it can wrap a router navigation.

const CELL = 28;
const HALF_MS = 360;

export function pixelWipe(swap: () => void, color = "#120d18") {
  if (
    typeof window === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    swap();
    return;
  }
  const cv = document.createElement("canvas");
  const w = (cv.width = window.innerWidth);
  const h = (cv.height = window.innerHeight);
  Object.assign(cv.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "200",
    pointerEvents: "none",
  });
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  if (!ctx) {
    cv.remove();
    swap();
    return;
  }
  const cells: [number, number, number][] = [];
  for (let y = 0; y < h; y += CELL)
    for (let x = 0; x < w; x += CELL)
      cells.push([x, y, Math.hypot(x - w / 2, y - h / 2) + Math.random() * 120]);
  const maxD = Math.max(1, ...cells.map((c) => c[2]));
  const t0 = performance.now();
  let swapped = false;
  ctx.fillStyle = color;
  const step = (now: number) => {
    const k = (now - t0) / HALF_MS;
    ctx.clearRect(0, 0, w, h);
    if (k < 1) {
      for (const [x, y, d] of cells) if (d / maxD < k) ctx.fillRect(x, y, CELL, CELL);
    } else if (k < 2) {
      if (!swapped) {
        swapped = true;
        swap();
      }
      for (const [x, y, d] of cells) if (d / maxD >= k - 1) ctx.fillRect(x, y, CELL, CELL);
    } else {
      cv.remove();
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
