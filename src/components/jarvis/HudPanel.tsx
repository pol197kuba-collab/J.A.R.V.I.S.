import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HudTag } from "./HudTag";
import { useRouteTransition } from "./TransitionContext";
import { usePhase } from "./PhaseContext";
import { useArkReboot } from "./ArkRebootContext";

export function HudPanel({
  children,
  className,
  index = 0,
  tagSeed,
  showTag = true,
  title,
  rightSlot,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  tagSeed?: number;
  showTag?: boolean;
  title?: string;
  rightSlot?: ReactNode;
}) {
  const { transition } = useRouteTransition();
  const { phase } = usePhase();
  const { isDiagnosticRunning } = useArkReboot();

  // Latch "was a reboot active when this panel mounted?" so the cascade
  // animation plays exactly once and never re-triggers if the reboot
  // flag flips off mid-animation.
  const [rebuildOnMount] = useState(() => isDiagnosticRunning);

  const materializing =
    transition === "materialize" || phase === "transition_to_dashboard";
  const dematerializing = phase === "shutdown";

  const seed = tagSeed ?? index * 9173 + 31;

  // ~110ms per panel index, capped so longer routes don't drag on.
  const rebuildDelayMs = Math.min(index * 110, 1800);

  return (
    <div
      className={cn(
        "hud-panel relative",
        materializing && "animate-hud-tile-in",
        dematerializing && "animate-tile-dissolve",
        rebuildOnMount && "animate-fade-in-up",
        className,
      )}
      style={{
        animationDelay: materializing
          ? `${index * 110}ms`
          : rebuildOnMount
            ? `${rebuildDelayMs}ms`
            : undefined,
      }}
    >
      <span className="hud-corner tl" />
      <span className="hud-corner tr" />
      <span className="hud-corner bl" />
      <span className="hud-corner br" />
      {showTag && <HudTag seed={seed} corner="tr" />}
      {showTag && <HudTag seed={seed + 7} corner="bl" />}
      {(title || rightSlot) && (
        <div className="flex items-center justify-between border-b border-primary/25 px-4 py-2">
          {title && (
            <span className="font-display text-[10px] uppercase tracking-[0.35em] text-primary/90">
              {title}
            </span>
          )}
          {rightSlot}
        </div>
      )}
      {children}
    </div>
  );
}