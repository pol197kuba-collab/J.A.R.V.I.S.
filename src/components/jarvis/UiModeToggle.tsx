import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { audio } from "@/lib/audio/AudioEngine";
import { MODE_HOME, setUiMode, useUiMode, type UiMode } from "@/lib/theme/uiMode";
import { pixelWipe } from "@/lib/theme/pixelWipe";

const OPTIONS: { mode: UiMode; label: string }[] = [
  { mode: "hud", label: "HUD" },
  { mode: "town", label: "Town" },
];

/**
 * HUD / TOWN switch in the header. Switching reskins the whole app (theme on
 * <html>) and opens that mode's home view, behind a pixel wipe.
 */
export function UiModeToggle({ compact = false }: { compact?: boolean }) {
  const mode = useUiMode();
  const navigate = useNavigate();

  return (
    <div
      role="group"
      aria-label="Tryb aplikacji"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-primary/30 bg-primary/[0.04] p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          aria-pressed={mode === o.mode}
          onClick={() => {
            if (o.mode === mode) return;
            audio.playClick();
            pixelWipe(() => {
              setUiMode(o.mode);
              void navigate({ to: MODE_HOME[o.mode] });
            });
          }}
          className={cn(
            "font-display rounded-full uppercase tracking-[0.25em] transition-colors",
            compact ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
            mode === o.mode
              ? "bg-primary text-primary-foreground"
              : "text-primary/70 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
