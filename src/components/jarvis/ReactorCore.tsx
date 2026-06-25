import { useEffect, useRef, type CSSProperties } from "react";
import { useMicAnalyser } from "@/lib/audio/useMicAnalyser";
import { CoreAudioSpectrum } from "./CoreAudioSpectrum";

const AMBER = "oklch(0.85 0.2 65)";
const AMBER_HI = "oklch(0.95 0.18 75)";
const AMBER_DEEP = "oklch(0.65 0.22 50)";

export function ReactorCore({ active }: { active?: boolean }) {
  // Audio level lives in a ref (mutated every frame) — no React re-renders.
  const levelRef = useRef<number>(0);
  useMicAnalyser(!!active, levelRef);

  // Coord text refs — updated via rAF (no state).
  const nRef = useRef<HTMLSpanElement | null>(null);
  const sRef = useRef<HTMLSpanElement | null>(null);
  const wRef = useRef<HTMLSpanElement | null>(null);
  const eRef = useRef<HTMLSpanElement | null>(null);

  // Canvas particle field
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // CSS var targets for glow/halo
  const haloRef = useRef<HTMLDivElement | null>(null);
  const ringStageRef = useRef<HTMLDivElement | null>(null);

  // Static (non-reactive) ring filter — heavy drop-shadow only on outer/inner layers.
  const ringHeavy: CSSProperties = {
    color: AMBER,
    filter: `drop-shadow(0 0 8px ${AMBER}) drop-shadow(0 0 18px oklch(0.85 0.2 65 / 0.55))`,
  };
  const ringLight: CSSProperties = { color: AMBER };

  // Reusable ring SVG renderer — each ring becomes its own absolutely
  // positioned 3D layer so it can sit at a unique translateZ.
  const ringWrap = "absolute inset-0 flex items-center justify-center";
  const svgFull = "h-full w-full";

  // Particle field on canvas (1 DOM element, single rAF loop)
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = cvs.getBoundingClientRect();
      cvs.width = rect.width * dpr;
      cvs.height = rect.height * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    type P = { a: number; r: number; rb: number; sp: number; sz: number; ph: number };
    const PARTS: P[] = Array.from({ length: 22 }, (_, i) => ({
      a: (i / 22) * Math.PI * 2 + Math.random(),
      r: 0.18 + Math.random() * 0.18,
      rb: 0.04 + Math.random() * 0.08,
      sp: 0.0006 + Math.random() * 0.0014,
      sz: 1.2 + Math.random() * 2.2,
      ph: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let last = performance.now();
    let coordTick = 0;
    const draw = (t: number) => {
      const dt = t - last;
      last = t;
      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      const w = cvs.width;
      const h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const lvl = levelRef.current;

      // Reactive halo via CSS vars (no React re-render)
      if (haloRef.current) {
        haloRef.current.style.setProperty("--lvl", lvl.toFixed(3));
      }

      for (let i = 0; i < PARTS.length; i++) {
        const p = PARTS[i];
        p.a += p.sp * dt * (1 + lvl * 2);
        const wobble = Math.sin(t * 0.001 + p.ph) * p.rb;
        const rad = (p.r + wobble + lvl * 0.06) * Math.min(w, h) * 0.5;
        const x = cx + Math.cos(p.a) * rad;
        const y = cy + Math.sin(p.a) * rad;
        const sz = p.sz * dpr * (1 + lvl * 0.8);
        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 196, 110, 0.85)";
        ctx.shadowColor = "rgba(255, 170, 70, 0.9)";
        ctx.shadowBlur = 10 * dpr;
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }

      // Coord refresh ~5/s when active, ~0.5/s otherwise
      coordTick += dt;
      const every = active ? 200 : 2000;
      if (coordTick > every) {
        coordTick = 0;
        const rnd = () => Math.floor(Math.random() * 9999).toString().padStart(4, "0");
        if (nRef.current) nRef.current.textContent = `N • ${rnd()}`;
        if (sRef.current) sRef.current.textContent = `S • ${rnd()}`;
        if (wRef.current) wRef.current.textContent = `W • ${rnd()}`;
        if (eRef.current) eRef.current.textContent = `E • ${rnd()}`;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active]);

  return (
    <div className="reactor-gpu relative flex aspect-square w-full max-w-[420px] items-center justify-center text-[oklch(0.85_0.2_65)] animate-holo-glitch">
      {/* Crosshair axes with coordinates */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[oklch(0.85_0.2_65/0.35)] to-transparent" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-[oklch(0.85_0.2_65/0.35)] to-transparent" />
        <span ref={nRef} className="absolute left-1/2 top-1 -translate-x-1/2 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">N • 0001</span>
        <span ref={sRef} className="absolute bottom-1 left-1/2 -translate-x-1/2 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">S • 0002</span>
        <span ref={wRef} className="absolute left-1 top-1/2 -translate-y-1/2 rotate-[-90deg] font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">W • 0003</span>
        <span ref={eRef} className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">E • 0004</span>
      </div>

      {/* Particle cloud (canvas — single DOM element) */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Cyan radial frequency spectrum — sits outside the 3D layer */}
      <CoreAudioSpectrum active={!!active} />

      {/* 3D Holographic Gyroscope */}
      <div className="reactor-perspective absolute inset-0">
        <div ref={ringStageRef} className="reactor-stage absolute inset-0 sphere-blend">
          {/* Holographic wireframe sphere — meridians + parallels */}
          <div className="sphere-wire absolute inset-[12%]">
            {[0, 30, 60, 90, 120, 150].map((deg) => (
              <div
                key={`m${deg}`}
                className="sphere-meridian"
                style={{ transform: `rotateY(${deg}deg)` }}
              />
            ))}
            {[-60, -30, 0, 30, 60].map((deg) => (
              <div
                key={`p${deg}`}
                className="sphere-meridian"
                style={{ transform: `rotateX(90deg) translateZ(${deg * 1.2}px) scale(${Math.cos((deg * Math.PI) / 180).toFixed(3)})` }}
              />
            ))}
          </div>

          {/* Ring 1 — outer dashed, tilted */}
          <div className={`${ringWrap} ring3d-a`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringHeavy}>
              <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 6" opacity="0.85" />
            </svg>
          </div>

          {/* Ring 2 — tick marks */}
          <div className={`${ringWrap} ring3d-b`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringLight}>
              <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
              {Array.from({ length: 60 }).map((_, i) => {
                const a = (i / 60) * Math.PI * 2;
                const x1 = 100 + Math.cos(a) * 86;
                const y1 = 100 + Math.sin(a) * 86;
                const len = i % 5 === 0 ? 6 : 3;
                const x2 = 100 + Math.cos(a) * (86 - len);
                const y2 = 100 + Math.sin(a) * (86 - len);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.6" opacity={i % 5 === 0 ? 0.95 : 0.55} />;
              })}
            </svg>
          </div>

          {/* Ring 3 — vertical globus spin (rotateY 360) */}
          <div className={`${ringWrap} ring3d-c`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringLight}>
              <circle cx="100" cy="100" r="74" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="0.4 3" strokeLinecap="round" opacity="0.9" />
            </svg>
          </div>

          {/* Ring 4 — segmented arcs */}
          <div className={`${ringWrap} ring3d-d`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringLight}>
              {[0, 90, 180, 270].map((rot) => (
                <path
                  key={rot}
                  d="M100,38 A62,62 0 0 1 162,100"
                  transform={`rotate(${rot} 100 100)`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  opacity="0.95"
                  strokeDasharray="40 14"
                />
              ))}
            </svg>
          </div>

          {/* Ring 5 — inner notched */}
          <div className={`${ringWrap} ring3d-e`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringLight}>
              <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.7" />
              {[0, 60, 120, 180, 240, 300].map((rot) => (
                <rect key={rot} x="99" y="46" width="2" height="6" fill="currentColor" transform={`rotate(${rot} 100 100)`} />
              ))}
            </svg>
          </div>

          {/* Ring 6 — innermost fast */}
          <div className={`${ringWrap} ring3d-f`}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringHeavy}>
              <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" opacity="0.95" />
            </svg>
          </div>

          {/* Core glow — always front-facing at Z=0 */}
          <div className={`${ringWrap}`} style={{ transform: "translateZ(0)" }}>
            <svg viewBox="0 0 200 200" className={svgFull} style={ringHeavy}>
              <defs>
                <radialGradient id="amber-core" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="oklch(0.99 0.05 75)" stopOpacity="1" />
                  <stop offset="25%" stopColor={AMBER_HI} stopOpacity="0.95" />
                  <stop offset="60%" stopColor={AMBER} stopOpacity="0.55" />
                  <stop offset="100%" stopColor={AMBER_DEEP} stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="100" cy="100" r="36" fill="url(#amber-core)" className={active ? "animate-amber-pulse-fast" : "animate-amber-pulse"} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
              <circle cx="100" cy="100" r="14" fill={AMBER_HI} opacity="0.9" />
              <circle cx="100" cy="100" r="6" fill="white" />
            </svg>
          </div>
        </div>
      </div>

      {/* Audio-reactive halo (driven via CSS var --lvl, mutated by rAF) */}
      {active && (
        <div
          ref={haloRef}
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            border: "1px solid oklch(0.9 0.2 70 / 0.4)",
            boxShadow:
              "0 0 calc(20px + var(--lvl, 0) * 80px) oklch(0.9 0.22 70 / calc(0.4 + var(--lvl, 0) * 0.5)), inset 0 0 calc(10px + var(--lvl, 0) * 40px) oklch(0.85 0.2 65 / 0.35)",
            transform: "scale(calc(1 + var(--lvl, 0) * 0.12))",
            transition: "transform 80ms linear",
          }}
        />
      )}

      {/* Scanline */}
      <div className="pointer-events-none absolute inset-6 overflow-hidden rounded-full">
        <div
          className="animate-scanline h-[2px] w-full"
          style={{ background: "linear-gradient(90deg, transparent, oklch(0.95 0.2 70 / 0.85), transparent)" }}
        />
      </div>
    </div>
  );
}