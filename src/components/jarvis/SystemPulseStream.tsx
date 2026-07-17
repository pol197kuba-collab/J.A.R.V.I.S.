import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { listSystemEvents } from "@/lib/system/events.functions";

// Replaces the old ThreatStream widget, which rendered entirely fabricated
// "global threat" data (data/threatStream.ts, never fed by anything real).
// Same visual language (color-coded ticker, fade-in), but sourced from the
// real system_events telemetry — the same feed System Logs reads.

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--primary)",
  warn: "var(--warning)",
  error: "var(--destructive)",
  debug: "var(--muted-foreground)",
};

function formatTs(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

export function SystemPulseStream({ index = 0 }: { index?: number }) {
  const fetchEvents = useServerFn(listSystemEvents);
  const { data: events = [] } = useQuery({
    queryKey: ["system_events", "pulse"],
    queryFn: () => fetchEvents({ data: { limit: 20 } }),
    refetchInterval: 5000,
  });

  return (
    <HudPanel index={index} title="SYSTEM PULSE // EVENT STREAM" className="flex flex-col">
      <div className="relative h-40 overflow-hidden p-2 landscape:max-md:h-24">
        {events.length === 0 ? (
          <p className="p-2 font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ▸ standing by — no events yet
          </p>
        ) : (
          <ul className="space-y-1">
            {events.map((it, i) => (
              <li
                key={it.id}
                className="flex items-center gap-2 border-l-2 pl-2 font-display text-[10px] uppercase tracking-[0.18em] landscape:max-md:text-[8px]"
                style={{
                  borderColor: `color-mix(in oklab, ${LEVEL_COLOR[it.level] ?? LEVEL_COLOR.info} 80%, transparent)`,
                  opacity: Math.max(0.35, 1 - i * 0.06),
                  animation: i === 0 ? "fade-up 0.5s ease-out both" : undefined,
                }}
              >
                <span
                  style={{ color: LEVEL_COLOR[it.level] ?? LEVEL_COLOR.info }}
                  className="w-12 shrink-0"
                >
                  {it.level.toUpperCase()}
                </span>
                <span className="text-muted-foreground">[{formatTs(it.createdAt)}]</span>
                <span className="truncate text-foreground/85">{it.message}</span>
              </li>
            ))}
          </ul>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 landscape:max-md:h-6"
          style={{ background: "linear-gradient(to top, oklch(0 0 0 / 0.95), transparent)" }}
        />
      </div>
    </HudPanel>
  );
}
