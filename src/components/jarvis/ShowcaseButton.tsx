import { Sparkles } from "lucide-react";
import { audio } from "@/lib/audio/AudioEngine";
import { useShowcase } from "./ShowcaseContext";
import { useArkReboot } from "./ArkRebootContext";

export function ShowcaseButton() {
  const { start, isRunning } = useShowcase();
  const { isDiagnosticRunning } = useArkReboot();
  const disabled = isRunning || isDiagnosticRunning;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        audio.playClick();
        start();
      }}
      aria-label="Run capability showcase"
      className="font-display group relative flex items-center gap-1.5 border border-primary/50 bg-primary/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-primary shadow-[0_0_12px_-4px_var(--primary)] transition disabled:cursor-not-allowed disabled:opacity-50 portrait:h-6 portrait:w-6 portrait:justify-center portrait:px-0 portrait:py-0 landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em] short:px-1.5 short:py-0.5 short:text-[8px] short:tracking-[0.2em]"
    >
      <Sparkles
        strokeWidth={1.75}
        className="h-3.5 w-3.5 portrait:h-3 portrait:w-3 landscape:max-md:h-3 landscape:max-md:w-3 short:h-3 short:w-3"
      />
      <span className="portrait:hidden landscape:max-md:hidden short:hidden">SHOWCASE</span>
    </button>
  );
}
