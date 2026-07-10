import { Mic, MicOff } from "lucide-react";
import { useVoiceCommands } from "./VoiceCommandContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { cn } from "@/lib/utils";

/**
 * Compact mic toggle for the system header. Mirrors the Vocal Override
 * switch but lives in the persistent (sticky) top bar so the user can
 * arm/disarm continuous listening from anywhere in the app.
 */
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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex h-6 w-6 items-center justify-center border transition landscape:max-md:h-5 landscape:max-md:w-5",
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
      <Icon className="h-3.5 w-3.5 landscape:max-md:h-3 landscape:max-md:w-3" strokeWidth={1.5} />
    </button>
  );
}