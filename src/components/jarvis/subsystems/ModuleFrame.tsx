import { Power } from "lucide-react";
import type { SubSystem } from "@/data/subSystems";
import { MiniArcReactor } from "@/components/jarvis/MiniArcReactor";
import { audio } from "@/lib/audio/AudioEngine";

export function ModuleFrame({
  mod,
  onTerminate,
}: {
  mod: SubSystem;
  onTerminate: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black animate-hud-tile-in landscape:max-md:fixed landscape:max-md:z-[100]">
      {/* Top HUD bar */}
      <div
        className="relative flex h-9 items-center gap-3 border-b border-primary/40 bg-black/90 px-3 landscape:max-md:h-8 landscape:max-md:gap-1.5 landscape:max-md:px-2"
        style={{ boxShadow: "0 6px 18px color-mix(in oklab, var(--primary) 18%, transparent)" }}
      >
        <MiniArcReactor size={18} />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/90 landscape:max-md:hidden">
          Module hosted via STARK_OS_V3 // Secure Terminal
        </span>
        <span className="h-3 w-px bg-primary/40 landscape:max-md:hidden" />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-foreground/80 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.18em]">
          {mod.name}
        </span>
        <span className="h-3 w-px bg-primary/40 landscape:max-md:hidden" />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/70 landscape:max-md:hidden">
          {mod.sysRef}
        </span>

        <div className="ml-auto flex items-center gap-3 landscape:max-md:gap-1.5">
          <div className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.3em] landscape:max-md:hidden">
            <span
              className="h-1.5 w-1.5 animate-blink rounded-full"
              style={{ backgroundColor: "var(--success)" }}
            />
            <span style={{ color: "var(--success)" }}>Link: Stable</span>
          </div>
          <button
            type="button"
            onClick={() => {
              audio.playClick();
              onTerminate();
            }}
            className="group relative flex items-center gap-2 border px-3 py-1 font-display text-[10px] uppercase tracking-[0.3em] transition landscape:max-md:gap-1 landscape:max-md:px-2 landscape:max-md:py-0.5 landscape:max-md:text-[8px] landscape:max-md:tracking-[0.18em]"
            style={{
              color: "var(--destructive)",
              borderColor: "color-mix(in oklab, var(--destructive) 65%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
              boxShadow: "0 0 14px color-mix(in oklab, var(--destructive) 45%, transparent)",
            }}
          >
            <Power className="h-3 w-3" strokeWidth={1.5} />
            <span className="landscape:max-md:hidden">Terminate Process // Exit</span>
            <span className="hidden landscape:max-md:inline">Exit</span>
          </button>
        </div>
      </div>

      {/* iframe container */}
      <div className="relative flex-1">
        <iframe
          title={mod.name}
          src={mod.url}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="h-full w-full border-0 bg-white"
        />
        {/* subtle scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          aria-hidden
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0 2px, color-mix(in oklab, var(--primary) 70%, transparent) 2px 3px)",
          }}
        />
      </div>
    </div>
  );
}