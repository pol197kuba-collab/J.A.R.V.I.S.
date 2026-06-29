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

  const materializing =
    transition === "materialize" || phase === "transition_to_dashboard";
  const dematerializing = phase === "shutdown";

  const seed = tagSeed ?? index * 9173 + 31;

  return (
    <div
      className={cn(
        "hud-panel relative",
        materializing && "animate-hud-tile-in",
        dematerializing && "animate-tile-dissolve",
        className,
      )}
      style={{
        animationDelay: materializing ? `${index * 110}ms` : undefined,
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