import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { listSystemEvents, type SystemEvent } from "@/lib/system/events.functions";

const LEVEL_COLOR: Record<SystemEvent["level"], string> = {
  info: "var(--primary)",
  debug: "var(--muted-foreground)",
  warn: "var(--warning)",
  error: "var(--destructive)",
};

// system_events.source is a free-form string ("orchestrator", "tool.web_search",
// "tool.fetch_url", "marketer", ...) written by runOrchestrator's logEvent
// helper. Render it as a short HUD-style tag instead of the raw dotted slug.
function formatSource(source: string): string {
  if (source.startsWith("tool.")) return `TOOL·${source.slice(5).toUpperCase()}`;
  return source.toUpperCase();
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

export function AgentOpsFeed({ index = 0 }: { index?: number }) {
  const fetchEvents = useServerFn(listSystemEvents);

  const { data: events = [], isFetching } = useQuery({
    queryKey: ["system-events", "ops-feed"],
    queryFn: () => fetchEvents({ data: { limit: 25 } }),
    refetchInterval: 4000,
  });

  return (
    <HudPanel
      index={index}
      tone="quiet"
      title="AGENT OPS // LIVE FEED"
      rightSlot={
        <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-primary">
          <span
            className={
              "h-1.5 w-1.5 rounded-full bg-[color:var(--success)] " +
              (isFetching ? "animate-pulse" : "")
            }
          />
          LIVE
        </span>
      }
      className="flex flex-col"
    >
      <div className="relative h-48 overflow-hidden p-2 landscape:max-md:h-28">
        {events.length === 0 ? (
          <p className="p-2 font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            ▸ NO AGENT ACTIVITY YET…
          </p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <li
                key={e.id}
                className="flex min-w-0 items-start gap-2 border-l-2 pl-2 font-mono text-[10px] uppercase tracking-[0.08em] landscape:max-md:text-[8px]"
                style={{
                  borderColor: `color-mix(in oklab, ${LEVEL_COLOR[e.level]} 80%, transparent)`,
                  opacity: Math.max(0.35, 1 - i * 0.035),
                }}
              >
                <span className="shrink-0 text-muted-foreground">[{timeOf(e.createdAt)}]</span>
                <span style={{ color: LEVEL_COLOR[e.level] }} className="shrink-0">
                  {formatSource(e.source)}
                </span>
                <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground/85">
                  {e.message}
                </span>
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
