import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HudTag } from "./HudTag";
import { useRouteTransition } from "./TransitionContext";
import { usePhase } from "./PhaseContext";

export function HudPanel({
  children,
  className,
  index = 0,
  tagSeed,
  showTag = true,
  title,
  rightSlot,
  tone = "elevated",
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  tagSeed?: number;
  showTag?: boolean;
  title?: string;
  rightSlot?: ReactNode;
  /**
   * "elevated" panels float forward — full glass/glow lift, corner
   * brackets bleeding past the edge. Reserve for the one or two focal
   * panels per screen (hero, chat). "quiet" panels sit recessed into the
   * HUD surface instead of reading as an equal-weight floating window —
   * use for secondary telemetry/widget panels.
   */
  tone?: "elevated" | "quiet";
}) {
  const { transition } = useRouteTransition();
  const { phase } = usePhase();

  const materializing = transition === "materialize" || phase === "transition_to_dashboard";
  const dematerializing = phase === "shutdown";

  const seed = tagSeed ?? index * 9173 + 31;
  const elevated = tone === "elevated";

  return (
    <div
      className={cn(
        "relative",
        elevated && materializing && "animate-hud-shell-in",
        elevated && dematerializing && "animate-hud-shell-out",
      )}
      style={{
        animationDelay: elevated && materializing ? `${index * 110}ms` : undefined,
      }}
    >
      <div
        className={cn(
          "hud-panel relative",
          elevated ? "hud-panel--elevated" : "hud-panel--quiet",
          materializing && "animate-hud-tile-in",
          dematerializing && "animate-tile-dissolve",
          className,
        )}
        style={{
          animationDelay: materializing ? `${index * 110}ms` : undefined,
        }}
      >
        {(title || rightSlot) && (
          <div
            className={cn(
              "flex items-center justify-between px-4 py-2",
              elevated ? "border-b border-primary/25" : "border-b border-primary/10",
            )}
          >
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
      {elevated && (
        <>
          <span className="hud-corner tl" />
          <span className="hud-corner tr" />
          <span className="hud-corner bl" />
          <span className="hud-corner br" />
          {showTag && <HudTag seed={seed} corner="tr" />}
          {showTag && <HudTag seed={seed + 7} corner="bl" />}
        </>
      )}
    </div>
  );
}
