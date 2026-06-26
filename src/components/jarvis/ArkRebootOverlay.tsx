import { useArkReboot } from "./ArkRebootContext";
import { ReactorCore } from "./ReactorCore";

export function ArkRebootOverlay() {
  const { isDiagnosticRunning, current, logTail, flashKey } = useArkReboot();
  if (!isDiagnosticRunning) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-transparent animate-fade-in">
      {/* Brief amber flash, retriggered per module step. Kept light so the
          real UI rebuilding underneath stays visible. */}
      <div
        key={flashKey}
        className="pointer-events-none absolute inset-0 animate-ark-flash opacity-60 mix-blend-screen"
        aria-hidden
      />

      {/* Centered enlarged Arc Core. */}
      <div className="relative flex h-[80vmin] w-[80vmin] items-center justify-center animate-ark-pulse">
        <div className="absolute inset-0 scale-[1.35]">
          <ReactorCore />
        </div>
      </div>

      {/* Module label + streaming logs around the core. */}
      <div className="absolute inset-x-0 top-[8%] flex flex-col items-center gap-2 px-4">
        <p className="font-display rounded-sm bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[0.45em] text-[oklch(0.85_0.2_65)] backdrop-blur-sm">
          PROTOCOL // ARK REBOOT
        </p>
        <p
          className="font-display rounded-sm bg-black/55 px-4 py-1.5 text-2xl uppercase tracking-[0.4em] text-[oklch(0.95_0.18_75)] backdrop-blur-sm"
          style={{
            textShadow:
              "0 0 14px oklch(0.85 0.2 65 / 0.8), 0 0 32px oklch(0.85 0.2 65 / 0.5)",
          }}
        >
          {current?.module ?? "INITIALIZING"}
        </p>
      </div>

      <div className="absolute inset-x-0 bottom-[10%] flex flex-col items-center gap-1 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-4 py-3 backdrop-blur-[2px]">
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