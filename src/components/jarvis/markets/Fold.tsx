// Zwijana sekcja paneli rynku: szczegóły są pod ręką, ale domyślnie nie
// zasłaniają tego, co najważniejsze. Natywne <details> — działa bez JS,
// z klawiatury i w czytnikach ekranu.

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Fold({
  title,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  /** Krótka informacja obok tytułu, np. liczba elementów. */
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={cn("group mt-4 border-t border-primary/10 pt-3", className)}
      open={defaultOpen}
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-primary/70 transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="font-display min-w-0 flex-1 text-[9px] uppercase tracking-[0.25em] text-primary/80">
          {title}
        </span>
        {hint && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground @max-[380px]:hidden">
            {hint}
          </span>
        )}
      </summary>
      <div className="mt-2 min-w-0">{children}</div>
    </details>
  );
}
