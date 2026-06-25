import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Phase = "boot" | "ready" | "engaging" | "done";

const BOOT_LINES = [
  "> INITIALIZING STARK INDUSTRIES SECURE TERMINAL",
  "> LOADING NEURAL CORE / J-3140 ………… OK",
  "> HANDSHAKE ARC-REACTOR PROTOCOL …… OK",
  "> CALIBRATING HUD OVERLAY …………………… OK",
  "> BIOMETRIC LOCK ……………………… AWAITING USER",
];

export function JarvisBoot({ onEnter }: { onEnter: () => void }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (phase !== "boot") return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setVisibleLines(i);
      if (i >= BOOT_LINES.length) {
        clearInterval(id);
        setTimeout(() => setPhase("ready"), 350);
      }
    }, 280);
    return () => clearInterval(id);
  }, [phase]);

  const engage = () => {
    if (phase !== "ready") return;
    setPhase("engaging");
    setTimeout(() => {
      setPhase("done");
      onEnter();
    }, 1100);
  };

  if (phase === "done") return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background text-primary",
        phase === "engaging" && "animate-fade-out",
      )}
      aria-hidden={phase === "engaging"}
    >
      {/* Moving grid */}
      <div
        className="animate-grid-pan pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: "var(--grid-bg)", backgroundSize: "40px 40px" }}
      />
      {/* Radial vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, oklch(0.08 0.03 240 / 0.85) 100%)",
        }}
      />
      {/* Scanline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden">
        <div className="animate-scanline h-[2px] w-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      </div>

      {/* Corner HUD ticks */}
      <CornerTicks />

      {/* Central HUD scanner */}
      <div className="relative flex aspect-square w-[min(78vmin,720px)] items-center justify-center">
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full text-primary">
          <g fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.45">
            <circle cx="200" cy="200" r="198" />
            <circle cx="200" cy="200" r="170" strokeDasharray="2 6" />
            <circle cx="200" cy="200" r="140" />
            <circle cx="200" cy="200" r="110" strokeDasharray="1 4" />
            <circle cx="200" cy="200" r="78" />
          </g>
          {/* Tick marks */}
          <g stroke="currentColor" strokeWidth="0.8" opacity="0.7">
            {Array.from({ length: 60 }).map((_, i) => {
              const a = (i * Math.PI) / 30;
              const r1 = i % 5 === 0 ? 182 : 190;
              const r2 = 198;
              return (
                <line
                  key={i}
                  x1={200 + Math.cos(a) * r1}
                  y1={200 + Math.sin(a) * r1}
                  x2={200 + Math.cos(a) * r2}
                  y2={200 + Math.sin(a) * r2}
                />
              );
            })}
          </g>
          {/* Crosshair */}
          <g stroke="currentColor" strokeWidth="0.5" opacity="0.5">
            <line x1="0" y1="200" x2="400" y2="200" strokeDasharray="2 6" />
            <line x1="200" y1="0" x2="200" y2="400" strokeDasharray="2 6" />
          </g>
          {/* Animated trace arcs */}
          <g fill="none" strokeWidth="1.2" stroke="currentColor">
            <path className="animate-line-trace" d="M30 200 A170 170 0 0 1 370 200" opacity="0.9" />
            <path
              className="animate-line-trace"
              style={{ animationDelay: "0.4s" }}
              d="M370 200 A140 140 0 0 1 60 200"
              opacity="0.7"
            />
          </g>
        </svg>

        {/* Rotating radar sweep */}
        <div className="animate-hud-sweep absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, oklch(0.82 0.17 215 / 0.35) 30deg, transparent 60deg)",
              maskImage: "radial-gradient(circle, black 60%, transparent 70%)",
              WebkitMaskImage: "radial-gradient(circle, black 60%, transparent 70%)",
            }}
          />
        </div>

        {/* Central reactor */}
        <div className="relative flex h-1/3 w-1/3 items-center justify-center">
          <div
            className="animate-pulse-core h-full w-full rounded-full"
            style={{ background: "var(--gradient-core)", boxShadow: "var(--glow-primary)" }}
          />
          <div className="absolute inset-[35%] rounded-full bg-foreground" />
          {phase === "engaging" && (
            <div
              className="animate-iris-open absolute h-6 w-6 rounded-full"
              style={{ background: "var(--gradient-core)", boxShadow: "var(--glow-primary)" }}
            />
          )}
        </div>

        {/* Floating title above */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full text-center">
          <p className="font-display animate-hud-flicker text-[10px] uppercase tracking-[0.6em] text-primary/80">
            Stark Industries // Mark VII
          </p>
          <h1 className="font-display animate-glitch-in mt-2 text-5xl font-bold tracking-[0.3em] text-foreground md:text-6xl">
            J.A.R.V.I.S.
          </h1>
          <p
            className="font-display animate-fade-up mt-1 text-[10px] uppercase tracking-[0.5em] text-primary/70"
            style={{ animationDelay: "0.8s" }}
          >
            Just A Rather Very Intelligent System
          </p>
        </div>

        {/* Boot log under reactor */}
        <div className="absolute -bottom-2 left-1/2 w-[min(560px,90vw)] -translate-x-1/2 translate-y-full space-y-1 text-center font-mono text-[11px] leading-relaxed text-primary/80">
          {BOOT_LINES.slice(0, visibleLines).map((l, i) => (
            <p key={i} className="animate-fade-up">
              {l}
            </p>
          ))}
          {phase === "ready" && (
            <div className="animate-fade-up mt-6 flex flex-col items-center gap-3">
              <p className="font-display text-[10px] uppercase tracking-[0.4em] text-[color:var(--warning)]">
                ⚠ Authorization required
              </p>
              <button
                onClick={engage}
                className="group relative font-display cursor-pointer border border-primary/70 bg-primary/10 px-10 py-3 text-xs uppercase tracking-[0.4em] text-primary transition hover:bg-primary/20 hover:text-foreground"
                style={{ boxShadow: "var(--glow-primary)" }}
              >
                <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-primary" />
                <span className="absolute -right-px -top-px h-2 w-2 border-r border-t border-primary" />
                <span className="absolute -left-px -bottom-px h-2 w-2 border-l border-b border-primary" />
                <span className="absolute -right-px -bottom-px h-2 w-2 border-r border-b border-primary" />
                ▸ Engage JARVIS
              </button>
              <p className="font-mono text-[10px] text-muted-foreground">
                biometric · voiceprint · stark-id verified
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Side HUD readouts */}
      <SideReadout side="left" />
      <SideReadout side="right" />
    </div>
  );
}

function CornerTicks() {
  const C = ({ className }: { className: string }) => (
    <div className={cn("absolute h-6 w-6 border-primary/70", className)} />
  );
  return (
    <>
      <C className="left-4 top-4 border-l-2 border-t-2" />
      <C className="right-4 top-4 border-r-2 border-t-2" />
      <C className="left-4 bottom-4 border-l-2 border-b-2" />
      <C className="right-4 bottom-4 border-r-2 border-b-2" />
    </>
  );
}

function SideReadout({ side }: { side: "left" | "right" }) {
  const rows = side === "left"
    ? [
        ["CPU", "37%"],
        ["MEM", "12.4 GB"],
        ["NET", "1.2 Gb/s"],
        ["LAT", "07 ms"],
      ]
    : [
        ["GEO", "MALIBU 34.0259° N"],
        ["TEMP", "21.4 °C"],
        ["SEC", "LVL-7"],
        ["TIME", new Date().toLocaleTimeString()],
      ];
  return (
    <div
      className={cn(
        "absolute top-1/2 hidden -translate-y-1/2 space-y-2 font-mono text-[10px] uppercase tracking-widest text-primary/70 md:block",
        side === "left" ? "left-8" : "right-8 text-right",
      )}
    >
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="animate-fade-up flex items-center gap-3"
          style={{ animationDelay: `${0.2 + i * 0.15}s` }}
        >
          {side === "right" && <span className="text-foreground">{v}</span>}
          <span className="text-muted-foreground">{k}</span>
          {side === "left" && <span className="text-foreground">{v}</span>}
        </div>
      ))}
    </div>
  );
}