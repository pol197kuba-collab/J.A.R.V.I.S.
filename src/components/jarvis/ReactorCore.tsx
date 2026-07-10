import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { onSpeaking, isSpeakingNow } from "@/lib/audio/speak";

const AMBER = "oklch(0.85 0.2 65)";
const AMBER_HI = "oklch(0.95 0.18 75)";
const AMBER_DEEP = "oklch(0.65 0.22 50)";

export function ReactorCore({ active: _active }: { active?: boolean } = {}) {
  // The core is a "living heart": speech-reactive only. We no longer wire
  // the mic analyser here — the previous build's coords/scanline/cyan
  // spectrum have been removed for a clean amber aesthetic.
  void _active;
  const [speaking, setSpeaking] = useState<boolean>(() => isSpeakingNow());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;

  useEffect(() => onSpeaking(setSpeaking), []);

  // --- Touch/pointer interaction: drag to rotate, pinch to zoom, dbl-tap reset ---
  const interactRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ rx: 0, ry: 0, zoom: 1 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastSingleRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef(0);

  const applyTransform = (withTransition = false) => {
    const el = interactRef.current;
    if (!el) return;
    const { rx, ry, zoom } = stateRef.current;
    el.style.transition = withTransition ? "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(${zoom})`;
  };

  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      lastSingleRef.current = { x: e.clientX, y: e.clientY };
      // double-tap detect
      const now = performance.now();
      if (now - lastTapRef.current < 300) {
        stateRef.current = { rx: 0, ry: 0, zoom: 1 };
        applyTransform(true);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      pinchStartRef.current = { dist: dist2(pts[0], pts[1]), zoom: stateRef.current.zoom };
      lastSingleRef.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const d = dist2(pts[0], pts[1]);
      const ratio = d / pinchStartRef.current.dist;
      const z = Math.max(0.6, Math.min(1.8, pinchStartRef.current.zoom * ratio));
      stateRef.current.zoom = z;
      applyTransform(false);
    } else if (pointersRef.current.size === 1 && lastSingleRef.current) {
      const dx = e.clientX - lastSingleRef.current.x;
      const dy = e.clientY - lastSingleRef.current.y;
      lastSingleRef.current = { x: e.clientX, y: e.clientY };
      stateRef.current.ry += dx * 0.4;
      stateRef.current.rx -= dy * 0.4;
      applyTransform(false);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
    if (pointersRef.current.size === 1) {
      const p = Array.from(pointersRef.current.values())[0];
      lastSingleRef.current = { x: p.x, y: p.y };
    } else if (pointersRef.current.size === 0) {
      lastSingleRef.current = null;
    }
  };

  // Static (non-reactive) ring filter — heavy drop-shadow only on outer/inner layers.
  const ringHeavy: CSSProperties = {
    color: AMBER,
    filter: `drop-shadow(0 0 8px ${AMBER}) drop-shadow(0 0 18px oklch(0.85 0.2 65 / 0.55))`,
  };
  const ringLight: CSSProperties = { color: AMBER };

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
      const lvl = speakingRef.current
        ? 0.5 + 0.5 * Math.abs(Math.sin(t * 0.012))
        : 0.08 + 0.06 * Math.sin(t * 0.0015);

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

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      className={`reactor-gpu relative mx-auto flex aspect-square w-full max-w-[480px] items-center justify-center text-[oklch(0.85_0.2_65)]${speaking ? " is-speaking" : ""}`}
    >
      {/* Particle cloud (canvas — single DOM element) */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* 3D Holographic Gyroscope */}
      <div
        className="reactor-perspective absolute inset-0"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={interactRef}
          className="absolute inset-0"
          style={{ transformStyle: "preserve-3d", willChange: "transform" }}
        >
        <div className="reactor-stage absolute inset-0 sphere-blend">
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
              <circle
                cx="100"
                cy="100"
                r="36"
                fill="url(#amber-core)"
                className={speaking ? "animate-core-speak" : "animate-amber-pulse"}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              />
              <circle cx="100" cy="100" r="14" fill={AMBER_HI} opacity="0.9" />
              <circle cx="100" cy="100" r="6" fill="white" />
            </svg>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}