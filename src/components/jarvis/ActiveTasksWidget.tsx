import { activeTasks } from "@/data/mock";
import { Activity, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const statusStyle: Record<string, { dot: string; label: string }> = {
  running: { dot: "var(--success)", label: "RUN" },
  queued: { dot: "var(--muted-foreground)", label: "QUEUE" },
  warning: { dot: "var(--warning)", label: "WARN" },
};

export function ActiveTasksWidget() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-primary/20 px-4 py-2">
        <div className="flex items-center gap-2">
          <Activity strokeWidth={1.5} className="h-4 w-4 text-primary" />
          <span className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            BG Processes
          </span>
        </div>
        <span className="font-display text-[10px] uppercase tracking-widest text-primary/80">
          {activeTasks.length} RUNNING
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {activeTasks.map((t) => {
          const s = statusStyle[t.status];
          return (
            <div
              key={t.id}
              className="relative border border-primary/25 bg-black/40 p-3 transition hover:border-primary/70 hover:shadow-[var(--glow-primary)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                  <p className="font-display mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t.subsystem}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {t.status === "warning" && (
                    <AlertTriangle
                      strokeWidth={1.5}
                      className="h-3 w-3"
                      style={{ color: "var(--warning)" }}
                    />
                  )}
                  <span
                    className="h-2 w-2 animate-blink rounded-full"
                    style={{ backgroundColor: s.dot }}
                  />
                  <span
                    className="font-display text-[10px] uppercase tracking-widest"
                    style={{ color: s.dot }}
                  >
                    {s.label}
                  </span>
                </div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary/60">
                <div
                  className={cn(
                    "h-full rounded-full",
                    t.status === "warning" ? "bg-[color:var(--warning)]" : "bg-primary",
                  )}
                  style={{ width: `${t.progress}%`, boxShadow: "var(--glow-primary)" }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{t.progress}%</span>
                <span className="flex items-center gap-1">
                  <Clock strokeWidth={1.5} className="h-3 w-3" /> {t.elapsed}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
