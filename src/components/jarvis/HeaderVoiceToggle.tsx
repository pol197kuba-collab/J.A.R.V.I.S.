import { Mic, MicOff } from "lucide-react";
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

  const Icon = enabled ? Mic : MicOff;
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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex h-7 items-center gap-1.5 border px-2 font-display text-[9px] uppercase tracking-[0.22em] transition landscape:max-md:h-5 landscape:max-md:px-1 landscape:max-md:text-[7px] landscape:max-md:tracking-[0.15em]",
        enabled
          ? "border-primary bg-primary/15 text-primary shadow-[0_0_10px_rgba(56,189,248,0.55)]"
          : "border-primary/40 bg-primary/5 text-muted-foreground hover:text-primary",
        !supported && "cursor-not-allowed opacity-40",
      )}
    >
      {enabled && listening && (
        <span
          className="pointer-events-none absolute inset-0 animate-ping border border-primary/60"
          aria-hidden
        />
      )}
      <Icon className="h-3 w-3 shrink-0 landscape:max-md:h-2.5 landscape:max-md:w-2.5" strokeWidth={1.5} />
      <span className="portrait:hidden landscape:max-md:hidden">TALK TO JARVIS</span>
      {/* Live waveform — animated only when actively listening */}
      <span
        aria-hidden
        className={cn(
          "flex h-3 items-end gap-[2px] portrait:hidden landscape:max-md:hidden",
          !(enabled && listening) && "opacity-30",
        )}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] bg-current",
              enabled && listening ? "animate-voice-wave" : "h-1",
            )}
            style={
              enabled && listening
                ? { animationDelay: `${i * 90}ms` }
                : undefined
            }
          />
        ))}
      </span>
      <span
        className={cn(
          "border-l border-current/40 pl-1.5 text-[8px] tracking-[0.18em] portrait:hidden landscape:max-md:hidden",
          enabled && listening ? "text-primary" : "opacity-70",
        )}
      >
        {status}
      </span>
    </button>
  );
}