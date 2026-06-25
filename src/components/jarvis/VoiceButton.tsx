import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function VoiceButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {active && (
          <>
            <span className="animate-ripple absolute inset-0 rounded-full border-2 border-primary/60" />
            <span className="animate-ripple absolute inset-0 rounded-full border-2 border-primary/40 [animation-delay:0.4s]" />
          </>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          aria-label={active ? "Stop listening" : "Activate voice"}
          className={cn(
            "relative flex h-20 w-20 items-center justify-center rounded-full border-2 transition-all",
            "border-primary/60 bg-card/80 text-primary shadow-[var(--glow-primary)] backdrop-blur",
            "hover:bg-primary/10 hover:scale-105",
            active && "border-primary bg-primary/20",
          )}
        >
          {active ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
        </button>
      </div>

      <div className="flex h-10 items-end gap-1">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "w-1 origin-bottom rounded-full bg-primary/70",
              active ? "h-8" : "h-2 opacity-40",
            )}
            style={
              active
                ? {
                    animation: `wave-bar ${0.6 + (i % 5) * 0.12}s ease-in-out ${i * 0.05}s infinite`,
                  }
                : undefined
            }
          />
        ))}
      </div>

      <p className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
        {active ? "Listening…" : "Tap to speak"}
      </p>
    </div>
  );
}