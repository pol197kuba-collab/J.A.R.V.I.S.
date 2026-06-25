import { createFileRoute } from "@tanstack/react-router";
import { systemLogs } from "@/data/mock";
import { HudPanel } from "@/components/jarvis/HudPanel";

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
      <HudPanel index={0} title="TELEMETRY // STREAM" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SYSTEM LOGS</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {systemLogs.length} EVENTS // LIVE TAIL
        </p>
      </HudPanel>
      <HudPanel index={1} title="LOG STREAM // CORE" className="overflow-hidden">
        <div className="font-mono text-xs">
          <div className="grid grid-cols-[140px_80px_140px_1fr] gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
            <span>TIMESTAMP</span>
            <span>LEVEL</span>
            <span>SOURCE</span>
            <span>MESSAGE</span>
          </div>
          {systemLogs.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[140px_80px_140px_1fr] gap-3 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10"
            >
              <span className="text-muted-foreground">{l.ts}</span>
              <span
                style={{ color: levelColor[l.level] }}
                className="font-display tracking-widest"
              >
                ▸ {l.level}
              </span>
              <span className="text-primary/80">{l.source}</span>
              <span className="text-foreground">{l.msg}</span>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}