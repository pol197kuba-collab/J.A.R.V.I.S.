import { useArkReboot } from "./ArkRebootContext";
import { ArcReactorTriangle } from "./ArcReactorTriangle";

export function ArkRebootOverlay() {
  const { isDiagnosticRunning, current, logTail, flashKey } = useArkReboot();
  if (!isDiagnosticRunning) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in">
      {/* White → amber flash, retriggered per module step. */}
      <div
        key={flashKey}
        className="pointer-events-none absolute inset-0 animate-ark-flash"
        aria-hidden
      />

      {/* Centered enlarged Arc Core. */}
      <div className="relative flex h-[80vmin] w-[80vmin] items-center justify-center animate-ark-pulse">
        <ArcReactorTriangle className="!w-[70vmin]" />
      </div>

      {/* Module label + streaming logs around the core. */}
      <div className="absolute inset-x-0 top-[8%] flex flex-col items-center gap-2 px-4">
        <p className="font-display text-[10px] uppercase tracking-[0.45em] text-[oklch(0.85_0.2_65)]">
          PROTOCOL // ARK REBOOT
        </p>
        <p
          className="font-display text-2xl uppercase tracking-[0.4em] text-[oklch(0.95_0.18_75)]"
          style={{
            textShadow: "0 0 14px oklch(0.85 0.2 65 / 0.8), 0 0 32px oklch(0.85 0.2 65 / 0.5)",
          }}
        >
          {current?.module ?? "INITIALIZING"}
        </p>
      </div>

      <div className="absolute inset-x-0 bottom-[10%] flex flex-col items-center gap-1 px-4">
        {logTail.map((line, i) => (
          <p
            key={`${line}-${i}`}
            className="font-mono text-xs uppercase tracking-[0.25em] text-[oklch(0.85_0.2_65)] animate-log-streak"
            style={{
              opacity: 0.4 + i * 0.3,
              textShadow: "0 0 8px oklch(0.85 0.2 65 / 0.6)",
            }}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
