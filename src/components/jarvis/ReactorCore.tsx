import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const AMBER = "oklch(0.85 0.2 65)";
const AMBER_HI = "oklch(0.95 0.18 75)";
const AMBER_DEEP = "oklch(0.65 0.22 50)";

function useCoord(seed: number, active?: boolean) {
  const [v, setV] = useState(() => seed);
  useEffect(() => {
    const i = setInterval(
      () => setV(Math.floor(Math.random() * 9999)),
      active ? 600 : 2200 + seed * 13,
    );
    return () => clearInterval(i);
  }, [seed, active]);
  return v.toString().padStart(4, "0");
}

function useAudioLevel(active?: boolean) {
  // Simulated audio amplitude 0..1, updates ~20Hz when active
  const [level, setLevel] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 50) {
        // weighted noise — punchy bursts
        const n = Math.random();
        setLevel((prev) => prev * 0.55 + (n * n) * 0.45);
        last = t;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [active]);
  return level;
}

export function ReactorCore({ active }: { active?: boolean }) {
  const level = useAudioLevel(active);
  const cx = useCoord(1, active);
  const cy = useCoord(2, active);
  const cz = useCoord(3, active);
  const cw = useCoord(4, active);

  const particles = useMemo(
    () =>
      Array.from({ length: 26 }).map((_, i) => {
        const angle = (i / 26) * Math.PI * 2 + Math.random();
        const r = 40 + Math.random() * 40;
        return {
          left: `${50 + Math.cos(angle) * 18 + (Math.random() - 0.5) * 10}%`,
          top: `${50 + Math.sin(angle) * 18 + (Math.random() - 0.5) * 10}%`,
          px: `${Math.cos(angle) * r}px`,
          py: `${Math.sin(angle) * r - 10}px`,
          delay: `${(Math.random() * 4).toFixed(2)}s`,
          dur: `${(3 + Math.random() * 3).toFixed(2)}s`,
          size: 2 + Math.random() * 3,
        };
      }),
    [],
  );

  // Audio-reactive scale boost for outer rings
  const ringBoost = 1 + level * 0.18;
  const glowBoost = 0.6 + level * 1.4;

  return (
    <div className="relative flex aspect-square w-full max-w-[420px] items-center justify-center text-[oklch(0.85_0.2_65)] animate-holo-glitch">
      {/* Crosshair axes with coordinates */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[oklch(0.85_0.2_65/0.35)] to-transparent" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-[oklch(0.85_0.2_65/0.35)] to-transparent" />
        <span className="absolute left-1/2 top-1 -translate-x-1/2 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">
          N • {cx}
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">
          S • {cy}
        </span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 rotate-[-90deg] font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">
          W • {cz}
        </span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90 font-display text-[9px] tracking-[0.25em] text-[oklch(0.92_0.18_70)]">
          E • {cw}
        </span>
      </div>

      {/* Particle cloud */}
      <div className="pointer-events-none absolute inset-0">
        {particles.map((p, i) => (
          <span
            key={i}
            className="particle-dot"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.dur,
              ["--px" as never]: p.px,
              ["--py" as never]: p.py,
            }}
          />
        ))}
      </div>

      {/* Layered SVG rings */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        style={{ color: AMBER, filter: `drop-shadow(0 0 ${4 + glowBoost * 6}px ${AMBER})` }}
      >
        <defs>
          <radialGradient id="amber-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.99 0.05 75)" stopOpacity="1" />
            <stop offset="25%" stopColor={AMBER_HI} stopOpacity="0.95" />
            <stop offset="60%" stopColor={AMBER} stopOpacity="0.55" />
            <stop offset="100%" stopColor={AMBER_DEEP} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ring 1 — outer dashed, slow ccw */}
        <g
          className={cn("spin-ccw-28", active && "spin-ccw-12")}
          style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scale(${ringBoost})` }}
        >
          <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 6" opacity="0.7" />
        </g>

        {/* Ring 2 — tick marks, cw */}
        <g className={cn("spin-cw-22", active && "spin-cw-8")} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.35" />
          {Array.from({ length: 60 }).map((_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const x1 = 100 + Math.cos(a) * 86;
            const y1 = 100 + Math.sin(a) * 86;
            const len = i % 5 === 0 ? 6 : 3;
            const x2 = 100 + Math.cos(a) * (86 - len);
            const y2 = 100 + Math.sin(a) * (86 - len);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.6" opacity={i % 5 === 0 ? 0.95 : 0.55} />;
          })}
        </g>

        {/* Ring 3 — dotted ccw */}
        <g className="spin-ccw-18" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle cx="100" cy="100" r="74" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="0.4 3" strokeLinecap="round" opacity="0.85" />
        </g>

        {/* Ring 4 — segmented arcs cw */}
        <g className={cn("spin-cw-15", active && "spin-cw-8")} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          {[0, 90, 180, 270].map((rot) => (
            <path
              key={rot}
              d="M100,38 A62,62 0 0 1 162,100"
              transform={`rotate(${rot} 100 100)`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.85"
              strokeDasharray="40 14"
            />
          ))}
        </g>

        {/* Ring 5 — inner thin ccw with notches */}
        <g className="spin-ccw-12" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
          {[0, 60, 120, 180, 240, 300].map((rot) => (
            <rect key={rot} x="99" y="46" width="2" height="6" fill="currentColor" transform={`rotate(${rot} 100 100)`} />
          ))}
        </g>

        {/* Ring 6 — innermost fast cw */}
        <g className="spin-cw-8" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" opacity="0.9" />
        </g>

        {/* Core glow */}
        <circle cx="100" cy="100" r="36" fill="url(#amber-core)" className={active ? "animate-amber-pulse-fast" : "animate-amber-pulse"} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        <circle cx="100" cy="100" r="14" fill={AMBER_HI} opacity="0.9" />
        <circle cx="100" cy="100" r="6" fill="white" />
      </svg>

      {/* Audio-reactive halo */}
      {active && (
        <div
          className="pointer-events-none absolute inset-0 rounded-full animate-audio-ring"
          style={{
            ["--ring-scale" as never]: `${1 + level * 0.12}`,
            ["--ring-dur" as never]: `${0.35 + (1 - level) * 0.4}s`,
            boxShadow: `0 0 ${20 + level * 80}px oklch(0.9 0.22 70 / ${0.4 + level * 0.5}), inset 0 0 ${10 + level * 40}px oklch(0.85 0.2 65 / 0.35)`,
            border: "1px solid oklch(0.9 0.2 70 / 0.4)",
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