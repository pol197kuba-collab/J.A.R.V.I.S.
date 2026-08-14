import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useShowcase } from "./ShowcaseContext";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { SHOWCASE_COLD_OPEN, SHOWCASE_OUTRO } from "@/lib/showcase/sequence";
import type { AgentSummary } from "@/lib/agents/runtime.functions";

const FALLBACK_AGENTS = ["Orchestrator", "Analityk", "Strateg", "Strażnik", "Skryba"];

export function ShowcaseOverlay() {
  const { isRunning, phase, current, stepIndex, stepCount, agents, skip } = useShowcase();
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (phase === "step") setFlashKey((k) => k + 1);
  }, [phase, stepIndex]);

  if (!isRunning) return null;

  return (
    <div className="fixed inset-0 z-[130]" aria-live="polite">
      {/* Skip is ALWAYS reachable, in every phase — the one non-negotiable
          promise of a scripted demo: the viewer is never trapped in it. */}
      <button
        type="button"
        onClick={skip}
        aria-label="Skip demo (Esc)"
        className="pointer-events-auto absolute right-4 top-4 z-[140] flex items-center gap-1.5 rounded-full border border-primary/50 bg-black/70 px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.25em] text-primary/90 backdrop-blur transition hover:border-primary hover:bg-primary/15 hover:text-foreground"
      >
        <X className="h-3 w-3" strokeWidth={2} />
        Skip <span className="opacity-60">// Esc</span>
      </button>

      {(phase === "coldopen" || phase === "outro") && (
        <BookendScreen
          eyebrow={phase === "coldopen" ? "INITIATING CAPABILITY SHOWCASE" : "SHOWCASE COMPLETE"}
          narration={phase === "coldopen" ? SHOWCASE_COLD_OPEN.narration : SHOWCASE_OUTRO.narration}
        />
      )}

      {phase === "building" && current && <BuildingScreen label={current.label} />}

      {phase === "step" && current && (
        <>
          <div key={flashKey} className="pointer-events-none absolute inset-0 animate-ark-flash" />
          <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1 animate-fade-up">
            <span className="font-display text-[9px] uppercase tracking-[0.3em] text-primary/70">
              DEMO MODE // STEP {stepIndex + 1}/{stepCount}
            </span>
            <span
              className="font-display text-lg uppercase tracking-[0.3em] text-primary"
              style={{
                textShadow: "0 0 16px color-mix(in oklab, var(--primary) 70%, transparent)",
              }}
            >
              {current.label}
            </span>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6 sm:pb-8">
            <div
              key={current.id}
              className="max-w-2xl animate-fade-up rounded-lg border border-primary/30 bg-black/70 px-5 py-3 text-center backdrop-blur-md shadow-[0_0_32px_-12px_color-mix(in_oklab,var(--primary)_60%,transparent)]"
            >
              <p className="font-mono text-sm leading-relaxed text-foreground sm:text-base">
                {current.narration}
              </p>
            </div>
          </div>

          {current.flourish === "agent-orbit" && <AgentOrbit agents={agents} />}
        </>
      )}
    </div>
  );
}

function BookendScreen({ eyebrow, narration }: { eyebrow: string; narration: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black animate-fade-in">
      <p className="font-display animate-hud-flicker text-[10px] uppercase tracking-[0.5em] text-primary/70">
        {eyebrow}
      </p>
      <div className="animate-hud-shell-in">
        <ArcReactorTriangle />
      </div>
      <p className="max-w-lg px-6 text-center font-mono text-sm text-foreground/90 sm:text-base">
        {narration}
      </p>
    </div>
  );
}

function BuildingScreen({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black/90" aria-hidden>
      <div className="bg-grid absolute inset-0 opacity-25" />
      <div
        className="animate-hud-laser-scan absolute left-0 right-0 h-[2px]"
        style={{
          background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
          boxShadow:
            "0 0 24px var(--primary), 0 0 48px color-mix(in oklab, var(--primary) 60%, transparent)",
        }}
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <p className="font-display animate-hud-flicker-fast text-xs uppercase tracking-[0.5em] text-primary">
          COMPILING MODULE: {label}
          <span className="animate-blink">…</span>
        </p>
      </div>
    </div>
  );
}

function AgentOrbit({ agents }: { agents: AgentSummary[] }) {
  const names = agents.length > 0 ? agents.map((a) => a.name) : FALLBACK_AGENTS;
  const n = names.length;
  const radiusVmin = 26;
  const durationS = 4.5;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px] animate-fade-in">
      <div
        className="relative h-[60vmin] w-[60vmin]"
        style={{ animation: `ring-spin ${durationS}s linear infinite` }}
      >
        {names.map((name, i) => {
          const angle = (360 / n) * i;
          const rad = (angle * Math.PI) / 180;
          const x = 50 + radiusVmin * Math.cos(rad);
          const y = 50 + radiusVmin * Math.sin(rad);
          return (
            <div
              key={`${name}-${i}`}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                animation: `ring-spin-rev ${durationS}s linear infinite`,
              }}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary/70 bg-primary/10 font-display text-[10px] uppercase text-primary shadow-[0_0_20px_-4px_var(--primary)]"
                style={{ textShadow: "0 0 8px var(--primary)" }}
              >
                {name.slice(0, 2).toUpperCase()}
              </span>
              <span className="font-display max-w-[90px] truncate text-center text-[9px] uppercase tracking-[0.18em] text-foreground/90">
                {name}
              </span>
            </div>
          );
        })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <ArcReactorTriangle className="!w-[18vmin]" />
        </div>
      </div>
    </div>
  );
}
