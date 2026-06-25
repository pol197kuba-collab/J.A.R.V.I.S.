import { useEffect, useState } from "react";
import { useRouteTransition } from "./TransitionContext";

const MESSAGES = [
  "RECONFIGURING DATA STREAM…",
  "ANALYZING HUD LAYOUT…",
  "REROUTING TELEMETRY…",
  "REBUILDING INTERFACE NODE…",
];

export function HudRouteTransition() {
  const { transition } = useRouteTransition();
  const [msg, setMsg] = useState(MESSAGES[0]);

  useEffect(() => {
    if (transition === "dematerialize" || transition === "scan") {
      setMsg(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
    }
  }, [transition]);

  if (transition === "idle") return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
      {/* Step 1: vertical scanning bars during dematerialize */}
      {transition === "dematerialize" && (
        <>
          <div className="hud-vbars absolute inset-0 opacity-60" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 40%, oklch(0 0 0 / 0.7) 100%)",
            }}
          />
        </>
      )}

      {/* Step 2: laser scan + status text */}
      {transition === "scan" && (
        <>
          <div className="bg-grid absolute inset-0 opacity-30" />
          <div
            className="animate-hud-laser-scan absolute left-0 right-0 h-[2px]"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--primary), transparent)",
              boxShadow:
                "0 0 24px var(--primary), 0 0 48px color-mix(in oklab, var(--primary) 60%, transparent)",
            }}
          />
          <div
            className="animate-hud-laser-scan absolute left-0 right-0 h-[80px]"
            style={{
              background:
                "linear-gradient(180deg, transparent, color-mix(in oklab, var(--primary) 18%, transparent), transparent)",
              animationDelay: "-0.05s",
            }}
          />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <p className="font-display animate-hud-flicker-fast text-xs uppercase tracking-[0.5em] text-primary">
              {msg}
            </p>
            <p className="font-display mt-2 text-[10px] uppercase tracking-[0.4em] text-primary/60">
              // J.A.R.V.I.S. // HUD SUBSYSTEM
            </p>
          </div>
        </>
      )}

      {/* Corner status during all phases */}
      <div className="absolute left-4 top-4 font-display text-[10px] uppercase tracking-[0.3em] text-primary/80">
        ▸ TRANSITION:{" "}
        <span className="text-primary">{transition.toUpperCase()}</span>
      </div>
      <div className="absolute right-4 top-4 font-display text-[10px] uppercase tracking-[0.3em] text-primary/80">
        LOCK ◂
      </div>
    </div>
  );
}