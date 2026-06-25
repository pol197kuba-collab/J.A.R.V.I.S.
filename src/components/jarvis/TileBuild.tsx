import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePhase } from "./PhaseContext";

export function TileBuild({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { phase } = usePhase();
  const building = phase === "transition_to_dashboard";
  const dissolving = phase === "shutdown";

  return (
    <div
      className={cn(
        building && "animate-tile-build",
        dissolving && "animate-tile-dissolve",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}