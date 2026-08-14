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

const STATUS_COLOR: Record<string, string> = {
  active: "var(--success)",
  running: "var(--success)",
  idle: "var(--muted-foreground)",
  error: "var(--destructive)",
};

type OrbitAgent = { name: string; role: string | null; dotColor: string };

function AgentOrbit({ agents }: { agents: AgentSummary[] }) {
  const items: OrbitAgent[] =
    agents.length > 0
      ? agents.map((a) => ({
          name: a.name,
          role: a.role,
          dotColor: a.isEnabled
            ? (STATUS_COLOR[a.status] ?? "var(--success)")
            : "var(--muted-foreground)",
        }))
      : FALLBACK_AGENTS.map((name) => ({ name, role: null, dotColor: "var(--success)" }));
  const n = items.length;
  // Slow, readable sweep — legible names matter more than a flashy spin.
  // At this pace the ring completes well under one full turn during a
  // typical step's narration window, which is the point: you should be
  // able to actually READ who's in the roster, not just see a blur go by.
  const durationS = 11;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 animate-fade-in">
      <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary/80">
        ◢ {n} AGENTS ONLINE
      </p>
      <div
        className="relative aspect-square w-[min(84vmin,760px)]"
        style={{ animation: `ring-spin ${durationS}s linear infinite` }}
      >
        {items.map((agent, i) => {
          const angle = (360 / n) * i;
          const rad = (angle * Math.PI) / 180;
          const radiusPct = 36;
          const x = 50 + radiusPct * Math.cos(rad);
          const y = 50 + radiusPct * Math.sin(rad);
          return (
            <div
              key={`${agent.name}-${i}`}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                animation: `ring-spin-rev ${durationS}s linear infinite`,
              }}
            >
              <span
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/70 bg-primary/10 font-display text-xl uppercase text-primary shadow-[0_0_28px_-4px_var(--primary)]"
                style={{ textShadow: "0 0 10px var(--primary)" }}
              >
                {agent.name.slice(0, 2).toUpperCase()}
                <span
                  className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border border-black/60"
                  style={{
                    backgroundColor: agent.dotColor,
                    boxShadow: `0 0 8px ${agent.dotColor}`,
                  }}
                />
              </span>
              <span className="font-display max-w-[140px] truncate text-center text-sm uppercase tracking-[0.16em] text-foreground">
                {agent.name}
              </span>
              {agent.role && (
                <span className="font-mono max-w-[140px] truncate text-center text-[10px] text-muted-foreground">
                  {agent.role}
                </span>
              )}
            </div>
          );
        })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <ArcReactorTriangle className="!w-[22vmin]" />
        </div>
      </div>
    </div>
  );
}
