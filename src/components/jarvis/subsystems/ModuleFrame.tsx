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
    <div className="absolute inset-0 z-30 flex flex-col bg-black animate-hud-tile-in">
      {/* Top HUD bar */}
      <div
        className="relative flex h-9 items-center gap-3 border-b border-primary/40 bg-black/90 px-3"
        style={{ boxShadow: "0 6px 18px color-mix(in oklab, var(--primary) 18%, transparent)" }}
      >
        <MiniArcReactor size={18} />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/90">
          Module hosted via STARK_OS_V3 // Secure Terminal
        </span>
        <span className="h-3 w-px bg-primary/40" />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-foreground/80">
          {mod.name}
        </span>
        <span className="h-3 w-px bg-primary/40" />
        <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/70">
          {mod.sysRef}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.3em]">
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
            className="group relative flex items-center gap-2 border px-3 py-1 font-display text-[10px] uppercase tracking-[0.3em] transition"
            style={{
              color: "var(--destructive)",
              borderColor: "color-mix(in oklab, var(--destructive) 65%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
              boxShadow: "0 0 14px color-mix(in oklab, var(--destructive) 45%, transparent)",
            }}
          >
            <Power className="h-3 w-3" strokeWidth={1.5} />
            Terminate Process // Exit
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