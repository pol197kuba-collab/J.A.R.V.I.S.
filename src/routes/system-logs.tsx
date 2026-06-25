import { createFileRoute } from "@tanstack/react-router";
import { systemLogs } from "@/data/mock";

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
  INFO: "var(--primary)",
  WARN: "var(--warning)",
  ERROR: "var(--destructive)",
};

function SystemLogs() {
  return (
    <div className="space-y-6 p-6">
      <header>
        <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary">
          Telemetry // Stream
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold tracking-[0.15em]">SYSTEM LOGS</h1>
      </header>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card/50 font-mono text-xs backdrop-blur">
        <div className="grid grid-cols-[120px_80px_120px_1fr] gap-3 border-b border-border/60 bg-background/50 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Timestamp</span>
          <span>Level</span>
          <span>Source</span>
          <span>Message</span>
        </div>
        {systemLogs.map((l, i) => (
          <div
            key={i}
            className="grid grid-cols-[120px_80px_120px_1fr] gap-3 border-b border-border/40 px-4 py-2 last:border-0 hover:bg-primary/5"
          >
            <span className="text-muted-foreground">{l.ts}</span>
            <span style={{ color: levelColor[l.level] }} className="font-display tracking-widest">
              {l.level}
            </span>
            <span className="text-primary/80">{l.source}</span>
            <span className="text-foreground">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}