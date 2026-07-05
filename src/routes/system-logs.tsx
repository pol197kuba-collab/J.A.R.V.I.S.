import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { listSystemEvents } from "@/lib/system/events.functions";

export const Route = createFileRoute("/system-logs")({
  head: () => ({
    meta: [
      { title: "JARVIS // System Logs" },
      { name: "description", content: "Real-time system event log from the JARVIS core." },
    ],
  }),
  component: SystemLogs,
});

const levelColor: Record<string, string> = {
  info: "var(--primary)",
  warn: "var(--warning)",
  error: "var(--destructive)",
  debug: "var(--muted-foreground)",
};

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

function SystemLogs() {
  const fetchEvents = useServerFn(listSystemEvents);
  const { data: events = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["system_events", "list"],
    queryFn: () => fetchEvents({ data: { limit: 200 } }),
    refetchInterval: 4000,
  });

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="TELEMETRY // STREAM" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SYSTEM LOGS</h1>
        <div className="mt-1 flex items-center gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {events.length} EVENTS // LIVE TAIL {isFetching ? "// syncing…" : ""}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="font-display border border-primary/50 bg-primary/5 px-2 py-1 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/15"
          >
            ▸ Refresh
          </button>
        </div>
      </HudPanel>
      <HudPanel index={1} title="LOG STREAM // CORE" className="overflow-hidden">
        <div className="font-mono text-xs">
          <div className="grid grid-cols-[140px_80px_140px_1fr] gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
            <span>TIMESTAMP</span>
            <span>LEVEL</span>
            <span>SOURCE</span>
            <span>MESSAGE</span>
          </div>
          {isLoading && (
            <div className="px-4 py-3 text-muted-foreground">▸ awaiting telemetry…</div>
          )}
          {error && (
            <div className="px-4 py-3" style={{ color: "var(--destructive)" }}>
              ✕ log stream unreachable — {error instanceof Error ? error.message : String(error)}
            </div>
          )}
          {!isLoading && !error && events.length === 0 && (
            <div className="px-4 py-6 text-center text-muted-foreground">
              ▸ no events yet. Ask J.A.R.V.I.S. something to populate the log.
            </div>
          )}
          {events.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[140px_80px_140px_1fr] gap-3 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10"
            >
              <span className="text-muted-foreground">{formatTs(e.createdAt)}</span>
              <span
                style={{ color: levelColor[e.level] ?? "var(--muted-foreground)" }}
                className="font-display tracking-widest"
              >
                ▸ {e.level.toUpperCase()}
              </span>
              <span className="text-primary/80">{e.source}</span>
              <span className="text-foreground">{e.message}</span>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}