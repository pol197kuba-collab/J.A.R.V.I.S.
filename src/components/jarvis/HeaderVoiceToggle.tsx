import { useVoiceCommands } from "./VoiceCommandContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { cn } from "@/lib/utils";

export function HeaderVoiceToggle() {
  const { enabled, supported, listening, setEnabled } = useVoiceCommands();

  const onClick = () => {
    if (!supported) return;
    audio.playClick();
    const next = !enabled;
    if (next) speak("Sterowanie głosowe aktywne.");
    else speak("Sterowanie głosowe w trybie czuwania.");
    setEnabled(next);
  };

  const label = !supported
    ? "Voice unsupported"
    : enabled
      ? listening
        ? "Listening — disable mic"
        : "Vocal override armed — disable mic"
      : "Enable vocal override";

  const status = !supported
    ? "OFFLINE"
    : enabled
      ? listening
        ? "Listening…"
        : "Armed"
      : "Standby";

  const active = enabled;
  const live = enabled && listening;

  const Wave = ({ side }: { side: "left" | "right" }) => (
    <span
      aria-hidden
      className={cn(
        "flex h-3 items-end gap-[2px] portrait:hidden landscape:max-md:hidden short:hidden",
        side === "left" ? "flex-row" : "flex-row-reverse",
        !live && "opacity-30",
      )}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] bg-current",
            live ? "animate-voice-wave" : "h-1",
          )}
          style={live ? { animationDelay: `${i * 80}ms` } : undefined}
        />
      ))}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      className={cn(
        "group relative flex h-8 items-center gap-2 rounded-full border px-3 font-display uppercase transition landscape:max-md:h-6 landscape:max-md:gap-1 landscape:max-md:px-2 short:h-6 short:gap-1 short:px-2",
        active
          ? "border-primary bg-primary/10 text-primary shadow-[0_0_14px_rgba(56,189,248,0.55),inset_0_0_10px_rgba(56,189,248,0.25)]"
          : "border-primary/40 bg-primary/5 text-muted-foreground hover:text-primary hover:border-primary/70",
        !supported && "cursor-not-allowed opacity-40",
      )}
    >
      {live && (
        <span
          className="pointer-events-none absolute inset-0 animate-ping rounded-full border border-primary/60"
          aria-hidden
        />
      )}
      <Wave side="left" />
      <span className="flex flex-col items-center leading-none">
        <span className="text-[10px] tracking-[0.28em] landscape:max-md:text-[8px] landscape:max-md:tracking-[0.18em] short:text-[8px] short:tracking-[0.18em]">
          TALK TO JARVIS
        </span>
        <span
          className={cn(
            "mt-0.5 text-[8px] tracking-[0.22em] landscape:max-md:text-[7px] short:text-[7px]",
            live ? "text-primary" : "opacity-70",
          )}
        >
          {status}
        </span>
      </span>
      <Wave side="right" />
    </button>
  );
}