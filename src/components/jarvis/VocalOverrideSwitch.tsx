import { Switch } from "@/components/ui/switch";
import { useVoiceCommands } from "./VoiceCommandContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";

export function VocalOverrideSwitch() {
  const { enabled, supported, listening, lastTranscript, setEnabled } =
    useVoiceCommands();

  return (
    <div className="flex items-center gap-3 border border-primary/30 bg-black/60 px-3 py-1.5 landscape:max-md:px-2 landscape:max-md:py-1">
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (listening ? "animate-blink bg-primary" : "bg-muted-foreground/50")
        }
        style={listening ? { boxShadow: "var(--glow-primary)" } : undefined}
      />
      <div className="flex flex-col leading-tight">
        <span className="font-display text-[9px] uppercase tracking-[0.3em] text-primary/80 landscape:max-md:text-[8px]">
          VOCAL OVERRIDE // CONTINUOUS LISTEN
        </span>
        <span className="font-display text-[9px] uppercase tracking-[0.2em] text-muted-foreground landscape:max-md:text-[8px]">
          {supported
            ? enabled
              ? listening
                ? `LIVE • ${lastTranscript ? lastTranscript.slice(0, 28) : "AWAITING SIGNAL"}`
                : "STANDBY"
              : "INACTIVE"
            : "UNSUPPORTED // CHROME REQ."}
        </span>
      </div>
      <Switch
        checked={enabled}
        disabled={!supported}
        onCheckedChange={(v) => {
          audio.playClick();
          if (v) speak("Vocal override engaged. Listening for commands.");
          else speak("Vocal override standby.");
          setEnabled(v);
        }}
        aria-label="Vocal override"
        className="ml-2"
      />
    </div>
  );
}