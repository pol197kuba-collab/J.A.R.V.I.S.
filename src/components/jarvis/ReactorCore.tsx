import { cn } from "@/lib/utils";

export function ReactorCore({ active }: { active?: boolean }) {
  return (
    <div className="relative flex aspect-square w-full max-w-[420px] items-center justify-center">
      {/* outer faint ring */}
      <div className="absolute inset-0 rounded-full border border-primary/15" />
      <div className="absolute inset-4 rounded-full border border-primary/10" />

      {/* rotating ticks ring */}
      <div className="animate-ring-spin absolute inset-2 rounded-full" aria-hidden>
        <div className="absolute inset-0 rounded-full border border-dashed border-primary/40" />
      </div>
      <div className="animate-ring-spin-rev absolute inset-10 rounded-full" aria-hidden>
        <div className="absolute inset-0 rounded-full border border-dotted border-accent/50" />
      </div>

      {/* segmented ring */}
      <div className="absolute inset-16 rounded-full border-2 border-primary/30">
        <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[var(--glow-primary)]" />
        <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary shadow-[var(--glow-primary)]" />
        <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary shadow-[var(--glow-primary)]" />
        <div className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary shadow-[var(--glow-primary)]" />
      </div>

      {/* glowing core */}
      <div
        className={cn(
          "animate-pulse-core relative h-1/2 w-1/2 rounded-full",
          active && "[animation-duration:1.2s]",
        )}
        style={{
          background: "var(--gradient-core)",
          boxShadow: "var(--glow-primary)",
        }}
      >
        <div className="absolute inset-[18%] rounded-full bg-foreground/95 shadow-[var(--glow-primary)] backdrop-blur" />
        <div className="absolute inset-[28%] rounded-full bg-primary/90" />
        <div className="absolute inset-[36%] rounded-full bg-foreground" />
      </div>

      {/* scanline overlay */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <div className="animate-scanline h-[2px] w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      </div>
    </div>
  );
}