import { Mic } from "lucide-react";
import { useVoiceCommands } from "./VoiceCommandContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { cn } from "@/lib/utils";

/**
 * `iconOnly`: the narrow 3D visor (phone) — a microphone that glows when
 * voice control is armed and pulses while it listens; the full "TALK TO
 * JARVIS" label only fits a wide bar without its frame.
 */
export function HeaderVoiceToggle({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const { enabled, supported, listening, inConversation, setEnabled } = useVoiceCommands();

  const onClick = () => {
    if (!supported) return;
    audio.playClick();
    const next = !enabled;
    if (next) speak("Sterowanie głosowe aktywne.");
    else speak("Sterowanie głosowe w trybie czuwania.");
    setEnabled(next);
  };

  const conversing = enabled && listening && inConversation;

  const label = !supported
    ? "Voice unsupported"
    : enabled
      ? conversing
        ? "In conversation — speak freely, no wake word needed"
        : listening
          ? "Listening — disable mic"
          : "Vocal override armed — disable mic"
      : "Enable vocal override";

  const status = !supported
    ? "OFFLINE"
    : enabled
      ? conversing
        ? "In conversation"
        : listening
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
          className={cn("w-[2px] bg-current", live ? "animate-voice-wave" : "h-1")}
          style={live ? { animationDelay: `${i * 80}ms` } : undefined}
        />
      ))}
    </span>
  );

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!supported}
        aria-pressed={enabled}
        aria-label={label}
        title={`${label} · ${status}`}
        className={cn(
          "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          !supported && "cursor-not-allowed opacity-40",
          !active && "opacity-70",
        )}
      >
        {live && (
          <span
            className="pointer-events-none absolute inset-0 animate-ping rounded-full border border-primary/60"
            aria-hidden
          />
        )}
        <Mic className={cn("h-3.5 w-3.5", conversing && "animate-blink")} strokeWidth={1.75} />
      </button>
    );
  }

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
          ? "border-primary bg-primary/10 text-primary shadow-[0_0_14px_color-mix(in_oklab,var(--primary)_55%,transparent),inset_0_0_10px_color-mix(in_oklab,var(--primary)_25%,transparent)]"
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
        <span className="whitespace-nowrap text-[10px] tracking-[0.28em] landscape:max-md:text-[8px] landscape:max-md:tracking-[0.18em] short:text-[8px] short:tracking-[0.18em]">
          TALK TO JARVIS
        </span>
        <span
          className={cn(
            "mt-0.5 text-[8px] tracking-[0.22em] landscape:max-md:text-[7px] short:text-[7px]",
            live ? "text-primary" : "opacity-70",
            conversing && "animate-blink font-semibold",
          )}
        >
          {status}
        </span>
      </span>
      <Wave side="right" />
    </button>
  );
}
