import { useEffect, useState } from "react";
import { HudPanel } from "./HudPanel";
import { nextThreat, seedThreats, type ThreatLevel } from "@/data/threatStream";

const COLORS: Record<ThreatLevel, string> = {
  ALERT: "var(--warning)",
  DATA: "var(--primary)",
  WARNING: "var(--destructive)",
  INTEL: "var(--success)",
};

export function ThreatStream({ index = 0 }: { index?: number }) {
  const [items, setItems] = useState(() => seedThreats());

  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setItems((prev) => [nextThreat(n), ...prev].slice(0, 20));
    }, 5500);
    return () => clearInterval(id);
  }, []);

  return (
    <HudPanel index={index} title="GLOBAL THREAT // SAT-LINK STREAM" className="flex flex-col">
      <div className="relative h-40 overflow-hidden p-2 landscape:max-md:h-24">
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li
              key={it.id}
              className="flex items-center gap-2 border-l-2 pl-2 font-display text-[10px] uppercase tracking-[0.18em] landscape:max-md:text-[8px]"
              style={{
                borderColor: `color-mix(in oklab, ${COLORS[it.level]} 80%, transparent)`,
                opacity: Math.max(0.35, 1 - i * 0.06),
                animation: i === 0 ? "fade-up 0.5s ease-out both" : undefined,
              }}
            >
              <span style={{ color: COLORS[it.level] }} className="w-14 shrink-0">
                {it.level}
              </span>
              <span className="text-muted-foreground">[{it.time}]</span>
              <span className="truncate text-foreground/85">{it.text}</span>
            </li>
          ))}
        </ul>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 landscape:max-md:h-6"
          style={{ background: "linear-gradient(to top, oklch(0 0 0 / 0.95), transparent)" }}
        />
      </div>
    </HudPanel>
  );
}