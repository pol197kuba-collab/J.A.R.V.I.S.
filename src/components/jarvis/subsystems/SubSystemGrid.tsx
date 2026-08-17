import { useRef } from "react";
import { Fuel, Building2, BrainCircuit, Play } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { SUB_SYSTEMS, type SubSystemId } from "@/data/subSystems";
import { audio } from "@/lib/audio/AudioEngine";
import { speakJarvis } from "@/lib/ai/jarvisBrain";

const ICONS: Record<SubSystemId, typeof Fuel> = {
  "fuel-monitor": Fuel,
  "rto-calculator": Building2,
  "jobfit-ai": BrainCircuit,
};

const MODULE_PROMPT: Record<SubSystemId, { prompt: string; hint: string }> = {
  "fuel-monitor": {
    prompt:
      'The user just opened the Fuel Monitor module from the dashboard. Comment briefly and professionally. Action must be "none".',
    hint: "fuel",
  },
  "rto-calculator": {
    prompt:
      'The user just opened the RTO (Return To Office) calculator module. Comment briefly. Action must be "none".',
    hint: "rto",
  },
  "jobfit-ai": {
    prompt:
      'The user just launched the JobFit AI resume optimiser module. Comment briefly. Action must be "none".',
    hint: "jobfit",
  },
};

export function SubSystemGrid({
  onInitialize,
  disabled,
}: {
  onInitialize: (id: SubSystemId) => void;
  disabled?: boolean;
}) {
  // Guard: each module's "Initialize" button can only fire one Gemini speak
  // per click burst. Prevents double-tap / re-render from spamming the API.
  const lastClickRef = useRef<Map<SubSystemId, number>>(new Map());
  return (
    <div className="space-y-6 p-6 @max-[420px]:space-y-4 @max-[420px]:p-4">
      <HudPanel index={0} title="SUB-SYSTEMS // EXTERNAL MODULES" className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 pt-3">
          <h1 className="font-display text-2xl font-bold tracking-[0.18em] text-foreground @max-[420px]:text-lg">
            EXTERNAL MODULE PORTAL
          </h1>
          <p className="max-w-md text-xs text-muted-foreground">
            Select a sub-system to establish a secure tunnel via STARK_OS_V3.
          </p>
        </div>
      </HudPanel>

      <div className="grid grid-cols-1 gap-6 @[640px]:grid-cols-3 @max-[420px]:gap-3">
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
              <div className="flex flex-col gap-5 p-5 @max-[300px]:gap-3 @max-[300px]:p-3">
                <div className="flex items-start gap-3 @max-[300px]:gap-2">
                  <div className="border border-primary/40 p-2 shadow-[var(--glow-primary)]">
                    <Icon className="icon-neon h-6 w-6 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/70">
                      {mod.sysRef}
                    </p>
                    <p className="text-xs text-muted-foreground @max-[300px]:hidden">
                      {mod.description}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 border-t border-primary/20 pt-3 font-display text-[10px] uppercase tracking-[0.25em] text-primary/60 @max-[300px]:hidden">
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
                    const now = Date.now();
                    const last = lastClickRef.current.get(mod.id) ?? 0;
                    if (now - last < 3000) return;
                    lastClickRef.current.set(mod.id, now);
                    const m = MODULE_PROMPT[mod.id];
                    void speakJarvis({
                      prompt: m.prompt,
                      fallbackKind: "module",
                      fallbackHint: m.hint,
                    });
                    onInitialize(mod.id);
                  }}
                  className="group relative mt-2 flex items-center justify-center gap-2 border border-primary/60 bg-primary/10 px-4 py-2.5 font-display text-[11px] uppercase tracking-[0.35em] text-primary transition hover:bg-primary/20 disabled:opacity-40 @max-[300px]:mt-0 @max-[300px]:px-2 @max-[300px]:py-1 @max-[300px]:text-[8px] @max-[300px]:tracking-[0.18em]"
                  style={{ animation: "init-pulse 2s ease-in-out infinite" }}
                >
                  <span className="absolute -left-px -top-px h-1.5 w-1.5 border-l border-t border-primary" />
                  <span className="absolute -right-px -top-px h-1.5 w-1.5 border-r border-t border-primary" />
                  <span className="absolute -left-px -bottom-px h-1.5 w-1.5 border-l border-b border-primary" />
                  <span className="absolute -right-px -bottom-px h-1.5 w-1.5 border-r border-b border-primary" />
                  <Play className="h-3 w-3" strokeWidth={1.5} />
                  <span className="@max-[300px]:hidden">Initialize Module</span>
                  <span className="hidden @max-[300px]:inline">Init</span>
                </button>
              </div>
            </HudPanel>
          );
        })}
      </div>
    </div>
  );
}
