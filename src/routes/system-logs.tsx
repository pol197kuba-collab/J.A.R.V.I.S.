import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { clearSystemEvents, listSystemEvents } from "@/lib/system/events.functions";

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

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "19.10 17:28:35.063" — the year only when it isn't this one. */
function formatTs(iso: string) {
  const d = new Date(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? "" : `.${d.getFullYear()}`;
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${year} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

function SystemLogs() {
  const fetchEvents = useServerFn(listSystemEvents);
  const clearEvents = useServerFn(clearSystemEvents);
  const [confirmClear, setConfirmClear] = useState(false);
  const {
    data: events = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["system_events", "list"],
    queryFn: () => fetchEvents({ data: { limit: 200 } }),
    refetchInterval: 4000,
  });
  const clear = useMutation({
    mutationFn: () => clearEvents(),
    onSuccess: (r) => {
      setConfirmClear(false);
      toast.success(`Logi wyczyszczone (${r.deleted} wpisów) — czysta karta.`);
      void refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="TELEMETRY // STREAM" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SYSTEM LOGS</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
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
          {confirmClear ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
                className="font-display border border-destructive/60 bg-destructive/10 px-2 py-1 text-[10px] uppercase tracking-widest text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
              >
                {clear.isPending ? "Czyszczę…" : "▸ Tak, usuń wszystkie"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="font-display border border-primary/30 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground transition hover:bg-primary/10"
              >
                Anuluj
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={events.length === 0}
              className="font-display border border-destructive/40 px-2 py-1 text-[10px] uppercase tracking-widest text-destructive transition hover:bg-destructive/10 disabled:opacity-40"
            >
              ▸ Wyczyść logi
            </button>
          )}
        </div>
      </HudPanel>
      <HudPanel index={1} title="LOG STREAM // CORE" className="overflow-hidden">
        <div className="font-mono text-xs">
          <div className="hidden @[560px]:grid @[560px]:grid-cols-[150px_70px_130px_1fr] @[560px]:gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
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
          <div className="no-scrollbar max-h-[65vh] min-h-0 overflow-y-auto overflow-x-hidden">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10 @[560px]:grid @[560px]:grid-cols-[150px_70px_130px_1fr] @[560px]:items-start @[560px]:gap-y-0"
              >
                <span className="shrink-0 text-muted-foreground" title={e.createdAt}>
                  {formatTs(e.createdAt)}
                </span>
                <span
                  style={{ color: levelColor[e.level] ?? "var(--muted-foreground)" }}
                  className="shrink-0 font-display tracking-widest"
                >
                  ▸ {e.level.toUpperCase()}
                </span>
                <span className="min-w-0 truncate text-primary/80">{e.source}</span>
                <span className="min-w-0 basis-full break-words text-foreground @[560px]:basis-auto">
                  {e.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
