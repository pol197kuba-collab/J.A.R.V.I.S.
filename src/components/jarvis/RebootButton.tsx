import { Zap } from "lucide-react";
import { audio } from "@/lib/audio/AudioEngine";
import { useArkReboot } from "./ArkRebootContext";

export function RebootButton() {
  const { startReboot, isDiagnosticRunning } = useArkReboot();
  return (
    <button
      type="button"
      disabled={isDiagnosticRunning}
      onClick={() => {
        audio.playClick();
        startReboot();
      }}
      aria-label="Reboot system"
      className="font-display group relative flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.3em] transition disabled:cursor-not-allowed disabled:opacity-50 portrait:h-6 portrait:w-6 portrait:justify-center portrait:px-0 portrait:py-0 landscape:max-md:px-1.5 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.2em] short:px-1.5 short:py-0.5 short:text-[8px] short:tracking-[0.2em]"
      style={{
        color: "oklch(0.92 0.18 70)",
        borderColor: "oklch(0.85 0.2 65 / 0.6)",
        backgroundColor: "oklch(0.85 0.2 65 / 0.08)",
        boxShadow: "0 0 12px oklch(0.85 0.2 65 / 0.4)",
      }}
    >
      <Zap
        strokeWidth={1.75}
        className="h-3.5 w-3.5 portrait:h-3 portrait:w-3 landscape:max-md:h-3 landscape:max-md:w-3 short:h-3 short:w-3"
      />
      <span className="portrait:hidden landscape:max-md:hidden short:hidden">REBOOT SYSTEM</span>
      <span className="hidden landscape:max-md:inline short:inline">REBOOT</span>
    </button>
  );
}