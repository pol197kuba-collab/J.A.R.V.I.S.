import { useEffect, useRef } from "react";
import { acquireMic, releaseMic } from "@/lib/audio/micShared";

/**
 * Radial frequency-spectrum visualizer rendered on a single canvas.
 * Sits OUTSIDE the gyroscope's 3D transform tree so it never causes
 * reflows of the amber rings.
 */
export function CoreAudioSpectrum({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const r = cvs.getBoundingClientRect();
      cvs.width = Math.max(1, r.width * dpr);
      cvs.height = Math.max(1, r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    let raf = 0;
    let cancelled = false;
    let analyser: AnalyserNode | null = null;
    let bins: Uint8Array | null = null;
    let acquired = false;

    if (active) {
      (async () => {
        const a = await acquireMic();
        if (cancelled || !a) {
          if (a) releaseMic();
          return;
        }
        acquired = true;
        analyser = a;
        bins = new Uint8Array(analyser.frequencyBinCount);
      })();
    }

    const BARS = 72;
    let t0 = performance.now();
    const draw = (t: number) => {
      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      const w = cvs.width;
      const h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.46;
      const elapsed = (t - t0) / 1000;

      if (analyser && bins) analyser.getByteFrequencyData(bins);

      ctx.lineCap = "round";
      for (let i = 0; i < BARS; i++) {
        let v: number;
        if (bins) {
          // Sample logarithmically across the spectrum (skip DC, top noise)
          const idx = Math.floor(2 + (i / BARS) * (bins.length - 6));
          v = bins[idx] / 255;
        } else {
          // Idle: gentle multi-sine pulse so the ring never looks dead
          v = 0.18 + 0.12 * (Math.sin(elapsed * 1.6 + i * 0.22) * 0.5 + 0.5);
        }
        const len = (Math.min(w, h) * 0.085) + v * Math.min(w, h) * 0.16;
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(a) * baseR;
        const y1 = cy + Math.sin(a) * baseR;
        const x2 = cx + Math.cos(a) * (baseR + len);
        const y2 = cy + Math.sin(a) * (baseR + len);
        const alpha = 0.45 + v * 0.55;
        ctx.strokeStyle = `oklch(0.88 0.17 200 / ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1, dpr * 1.6);
        ctx.shadowColor = "oklch(0.88 0.17 200 / 0.9)";
        ctx.shadowBlur = 6 * dpr * (0.4 + v);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (acquired) releaseMic();
    };
  }, [active]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ mixBlendMode: "screen" }}
    />
  );
}