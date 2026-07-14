import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { bootLogs } from "@/data/mock";
import { audio } from "@/lib/audio/AudioEngine";
import { requestAppFullscreen } from "@/lib/fullscreen";

type Step = 1 | 2 | 3;

const JARVIS = "J.A.R.V.I.S.";

export function BootSequence({
  mode = "engage",
  onEngage,
  onComplete,
  onSkip,
}: {
  mode?: "engage" | "init";
  onEngage?: () => void;
  onComplete?: () => void;
  onSkip?: () => void;
}) {
  // engage mode renders only step 3; init mode runs step 1 -> step 2 -> done
  const [step, setStep] = useState<Step>(mode === "engage" ? 3 : 1);
  const [progress, setProgress] = useState(0);
  const [typed, setTyped] = useState(0);

  // Step progression for init mode: 5s step1 -> 5s step2 -> onComplete
  useEffect(() => {
    if (mode !== "init") return;
    audio.playBoot();
    const t1 = setTimeout(() => setStep(2), 5000);
    const t2 = setTimeout(() => onComplete?.(), 10000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [mode, onComplete]);

  // Step 1 progress bar
  useEffect(() => {
    if (step !== 1) return;
    const id = setInterval(() => {
      setProgress((p) => (p >= 100 ? 100 : p + 2.2));
    }, 100);
    return () => clearInterval(id);
  }, [step]);

  // Step 2 typing
  useEffect(() => {
    if (step !== 2) {
      if (step === 3) setTyped(JARVIS.length);
      return;
    }
    setTyped(0);
    const id = setInterval(() => {
      setTyped((n) => {
        if (n >= JARVIS.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, 320);
    return () => clearInterval(id);
  }, [step]);

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-full items-center justify-center overflow-hidden bg-black text-primary">
      {/* Moving grid backdrop */}
      <div
        className="animate-grid-pan pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: "var(--grid-bg)", backgroundSize: "40px 40px" }}
      />
      {/* Radial vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.95) 100%)",
        }}
      />
      <CornerTicks />

      {mode === "init" && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="group absolute right-4 top-4 z-50 font-display cursor-pointer border border-primary/50 bg-primary/5 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-primary/80 opacity-70 transition hover:bg-primary/15 hover:text-foreground hover:opacity-100"
          aria-label="Skip intro sequence"
        >
          <span className="absolute -left-px -top-px h-1.5 w-1.5 border-l border-t border-primary/70" />
          <span className="absolute -right-px -top-px h-1.5 w-1.5 border-r border-t border-primary/70" />
          <span className="absolute -left-px -bottom-px h-1.5 w-1.5 border-l border-b border-primary/70" />
          <span className="absolute -right-px -bottom-px h-1.5 w-1.5 border-r border-b border-primary/70" />
          SKIP
        </button>
      )}

      {mode === "init" && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-20 -translate-x-1/2 text-center animate-fade-up">
          <p
            className="font-display text-[11px] uppercase tracking-[0.5em] text-primary md:text-sm"
            style={{ textShadow: "0 0 12px oklch(0.82 0.17 215 / 0.8)" }}
          >
            ACCESS GRANTED. WELCOME BACK, MR. JACOB SLAWINSKY.
          </p>
        </div>
      )}

      {/* ============== STEP 1 ============== */}
      {step === 1 && (
        <div className="absolute inset-0 animate-fade-up">
          {/* Horizontal neon lines */}
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className="absolute h-px w-full origin-left"
                style={{
                  top: `${(i + 1) * 5}%`,
                  background:
                    "linear-gradient(90deg, transparent, oklch(0.82 0.17 215 / 0.7) 50%, transparent)",
                  animation: `line-trace 1.4s ease-out ${i * 0.08}s both`,
                  transform: "scaleX(0)",
                  transformOrigin: i % 2 === 0 ? "left" : "right",
                }}
              />
            ))}
          </div>

          {/* Pseudo logs — only on very wide screens to avoid overlap with the center bar */}
          <div className="pointer-events-none absolute left-4 top-1/2 hidden w-[240px] -translate-y-1/2 space-y-1 font-mono text-[10px] leading-relaxed text-primary/70 xl:block">
            {bootLogs.slice(0, Math.floor(progress / 8)).map((l, i) => (
              <p key={i} className="animate-fade-up">
                <span className="text-muted-foreground">{l.ts}</span>{" "}
                <span className="text-foreground">{l.tag}</span> {l.msg}
              </p>
            ))}
          </div>
          <div className="pointer-events-none absolute right-4 top-1/2 hidden w-[240px] -translate-y-1/2 space-y-1 text-right font-mono text-[10px] leading-relaxed text-primary/70 xl:block">
            {bootLogs.slice(6, 6 + Math.floor(progress / 8)).map((l, i) => (
              <p key={i} className="animate-fade-up">
                <span className="text-foreground">{l.tag}</span> {l.msg}
              </p>
            ))}
          </div>

          {/* Center progress bar */}
          <div className="absolute left-1/2 top-1/2 w-[min(560px,86vw)] -translate-x-1/2 -translate-y-1/2 space-y-3 text-center sm:space-y-4">
            <p className="font-display animate-hud-flicker text-[8px] uppercase tracking-[0.4em] text-primary/80 sm:text-[10px] sm:tracking-[0.6em]">
              Stark Industries // Secure Boot
            </p>
            <p className="font-display text-sm uppercase tracking-[0.25em] text-foreground sm:text-2xl sm:tracking-[0.4em]">
              INITIATING SYSTEM 1<span className="animate-blink">....</span>
            </p>
            <div className="relative h-1 w-full overflow-hidden border border-primary/50 bg-primary/5">
              <div
                className="h-full bg-primary transition-[width] duration-100 ease-linear"
                style={{ width: `${progress}%`, boxShadow: "var(--glow-primary)" }}
              />
            </div>
            <p className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground sm:text-[10px]">
              {progress.toFixed(0)}% &nbsp;//&nbsp; <span className="hidden sm:inline">HANDSHAKE PROTOCOL · ARC-NET · BIOMETRIC LOCK</span><span className="sm:hidden">HANDSHAKE · ARC-NET</span>
            </p>
          </div>
        </div>
      )}

      {/* ============== STEP 2 ============== */}
      {step === 2 && (
        <div className="relative animate-fade-up flex aspect-square w-[min(70vmin,640px)] items-center justify-center">
          <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full text-primary animate-ring-spin" style={{ animationDuration: "20s" }}>
            <g fill="none" stroke="currentColor" strokeWidth="0.8">
              <circle cx="200" cy="200" r="190" opacity="0.4" />
              <circle cx="200" cy="200" r="190" strokeDasharray="4 18" opacity="0.9" />
            </g>
          </svg>
          <svg viewBox="0 0 400 400" className="absolute inset-8 h-[calc(100%-4rem)] w-[calc(100%-4rem)] text-accent animate-ring-spin-rev" style={{ animationDuration: "14s" }}>
            <g fill="none" stroke="currentColor" strokeWidth="0.8">
              <circle cx="200" cy="200" r="180" strokeDasharray="1 8" opacity="0.7" />
              <circle cx="200" cy="200" r="160" opacity="0.3" />
            </g>
          </svg>
          <svg viewBox="0 0 400 400" className="absolute inset-20 h-[calc(100%-10rem)] w-[calc(100%-10rem)] text-primary animate-ring-spin" style={{ animationDuration: "9s" }}>
            <g fill="none" stroke="currentColor" strokeWidth="1">
              <circle cx="200" cy="200" r="180" strokeDasharray="40 12 4 12" opacity="0.8" />
            </g>
          </svg>

          <div className="relative z-10 text-center">
            <h1 className="font-display text-5xl font-bold tracking-[0.3em] text-foreground md:text-6xl" style={{ textShadow: "0 0 24px oklch(0.82 0.17 215 / 0.7)" }}>
              {JARVIS.slice(0, typed)}
              <span className="ml-1 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-blink bg-primary" />
            </h1>
            <p className="font-display mt-3 text-[10px] uppercase tracking-[0.5em] text-primary/70">
              Just A Rather Very Intelligent System
            </p>
          </div>
        </div>
      )}

      {/* ============== STEP 3 ============== */}
      {step === 3 && (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-4 px-6">
          {/* Background HUD text — placed behind, low z */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
            <p className="font-display select-none whitespace-nowrap text-[18vw] font-bold uppercase tracking-[0.3em] text-primary/[0.04]">
              JARVIS
            </p>
          </div>

          <div className="relative z-10 flex flex-col items-center gap-2 animate-fade-up">
            <p className="font-display text-[10px] uppercase tracking-[0.6em] text-primary/80">
              Arc Reactor // Online
            </p>
            <ArcReactorTriangle />
          </div>

          <div className="relative z-[60] flex flex-col items-center gap-3 animate-fade-up" style={{ animationDelay: "0.6s" }}>
            <p className="font-display text-[10px] uppercase tracking-[0.4em] text-[color:var(--warning)]">
              ⚠ Authorization required
            </p>
            <button
              type="button"
              onClick={() => {
                audio.playEngage();
                void requestAppFullscreen();
                onEngage?.();
              }}
              className="group relative font-display cursor-pointer border border-primary/70 bg-primary/10 px-12 py-4 text-sm uppercase tracking-[0.4em] text-primary transition hover:bg-primary/20 hover:text-foreground"
              style={{ boxShadow: "var(--glow-primary)" }}
            >
              <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-primary" />
              <span className="absolute -right-px -top-px h-2 w-2 border-r border-t border-primary" />
              <span className="absolute -left-px -bottom-px h-2 w-2 border-l border-b border-primary" />
              <span className="absolute -right-px -bottom-px h-2 w-2 border-r border-b border-primary" />
              ▸ Engage JARVIS
            </button>
            <p className="font-mono text-[10px] text-muted-foreground">
              biometric · voiceprint · jacob-id verified // match found: slawinsky, j.
            </p>
          </div>
        </div>
      )}
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