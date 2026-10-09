import { useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { UiModeToggle } from "@/components/jarvis/UiModeToggle";
import { getStartMode, setStartMode, type StartMode } from "@/lib/theme/uiMode";

const START_OPTIONS: { value: StartMode; label: string }[] = [
  { value: "last", label: "Ostatnio używany" },
  { value: "hud", label: "Zawsze HUD" },
  { value: "town", label: "Zawsze Agent Town" },
];

/** Settings → appearance: current mode and which mode a new session opens in. */
export function UiModeSettings({ index = 1 }: { index?: number }) {
  const [startMode, setStart] = useState<StartMode>(() => getStartMode());

  return (
    <HudPanel index={index} title="WYGLĄD // TRYB APLIKACJI" className="p-5">
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Aktywny tryb
          </span>
          <UiModeToggle />
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Tryb przy starcie
          </span>
          <select
            id="ui-start-mode"
            value={startMode}
            onChange={(e) => {
              const v = e.target.value as StartMode;
              setStart(v);
              setStartMode(v);
            }}
            className="rounded-md border border-primary/30 bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
          >
            {START_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 max-w-prose text-xs text-muted-foreground">
        HUD to klasyczny widok J.A.R.V.I.S. Agent Town zmienia wygląd całej aplikacji na pikselowy
        świat i otwiera biuro agentów. Ustawienie dotyczy tego urządzenia.
      </p>
    </HudPanel>
  );
}
