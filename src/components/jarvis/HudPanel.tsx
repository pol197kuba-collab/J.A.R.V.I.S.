import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HudTag } from "./HudTag";
import { useRouteTransition } from "./TransitionContext";
import { usePhase } from "./PhaseContext";

export function HudPanel({
  children,
  className,
  wrapperClassName,
  index = 0,
  tagSeed,
  showTag = true,
  title,
  rightSlot,
  tone = "elevated",
}: {
  children: ReactNode;
  className?: string;
  /**
   * Classes for the OUTER wrapper div — the element that actually
   * participates in the parent's flex/grid layout (corner brackets and
   * the HUD tag are its siblings, not `.hud-panel`'s). `className` only
   * reaches the inner `.hud-panel`, so a consumer that needs the whole
   * panel to grow/shrink in a flex column (`flex-1`, `min-h-0`, `h-full`)
   * must pass those here too, or the outer wrapper stays auto-sized and
   * the inner flex-1 has nothing definite to grow into — it silently
   * collapses to content size instead of filling available space.
   */
  wrapperClassName?: string;
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
        // @container: every panel is a query container for its own content —
        // children size themselves off the PANEL's rendered width (via @max-[…]:
        // variants) instead of viewport orientation. See CLAUDE.md "Responsive
        // panels" for the convention this replaces.
        "@container relative",
        elevated && materializing && "animate-hud-shell-in",
        elevated && dematerializing && "animate-hud-shell-out",
        wrapperClassName,
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
              "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 @max-[420px]:px-3",
              elevated ? "border-b border-primary/25" : "border-b border-primary/10",
            )}
          >
            {title && (
              <span className="font-display min-w-0 truncate text-[10px] uppercase tracking-[0.35em] text-primary/90 @max-[420px]:text-[9px] @max-[420px]:tracking-[0.22em]">
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
