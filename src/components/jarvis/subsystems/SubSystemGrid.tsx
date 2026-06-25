import { Fuel, Building2, BrainCircuit, Play } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { SUB_SYSTEMS, type SubSystemId } from "@/data/subSystems";
import { audio } from "@/lib/audio/AudioEngine";

const ICONS: Record<SubSystemId, typeof Fuel> = {
  "fuel-monitor": Fuel,
  "rto-calculator": Building2,
  "jobfit-ai": BrainCircuit,
};

export function SubSystemGrid({
  onInitialize,
  disabled,
}: {
  onInitialize: (id: SubSystemId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="SUB-SYSTEMS // EXTERNAL MODULES" className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 pt-3">
          <h1 className="font-display text-2xl font-bold tracking-[0.18em] text-foreground">
            EXTERNAL MODULE PORTAL
          </h1>
          <p className="max-w-md text-xs text-muted-foreground">
            Select a sub-system to establish a secure tunnel via STARK_OS_V3.
          </p>
        </div>
      </HudPanel>

      <div className="grid gap-6 md:grid-cols-3">
        {SUB_SYSTEMS.map((mod, i) => {
          const Icon = ICONS[mod.id];
          return (
            <HudPanel
              key={mod.id}
              index={i + 1}
              tagSeed={mod.id.length * 137 + i}
              title={mod.name}
              className="flex flex-col"
            >
              <div className="flex flex-col gap-5 p-5">
                <div className="flex items-start gap-3">
                  <div className="border border-primary/40 p-2 shadow-[var(--glow-primary)]">
                    <Icon className="icon-neon h-6 w-6 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/70">
                      {mod.sysRef}
                    </p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                </div>

                <div className="space-y-2 border-t border-primary/20 pt-3 font-display text-[10px] uppercase tracking-[0.25em] text-primary/60">
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className="text-[color:var(--success)]">● ready</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Channel</span>
                    <span className="text-foreground/80">{mod.codename}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onMouseEnter={() => audio.playClick()}
                  onClick={() => {
                    audio.playClick();
                    onInitialize(mod.id);
                  }}
                  className="group relative mt-2 flex items-center justify-center gap-2 border border-primary/60 bg-primary/10 px-4 py-2.5 font-display text-[11px] uppercase tracking-[0.35em] text-primary transition hover:bg-primary/20 disabled:opacity-40"
                  style={{ animation: "init-pulse 2s ease-in-out infinite" }}
                >
                  <span className="absolute -left-px -top-px h-1.5 w-1.5 border-l border-t border-primary" />
                  <span className="absolute -right-px -top-px h-1.5 w-1.5 border-r border-t border-primary" />
                  <span className="absolute -left-px -bottom-px h-1.5 w-1.5 border-l border-b border-primary" />
                  <span className="absolute -right-px -bottom-px h-1.5 w-1.5 border-r border-b border-primary" />
                  <Play className="h-3 w-3" strokeWidth={1.5} />
                  Initialize Module
                </button>
              </div>
            </HudPanel>
          );
        })}
      </div>
    </div>
  );
}