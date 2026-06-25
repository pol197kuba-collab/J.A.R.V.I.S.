import { systemStats } from "@/data/mock";

export function SystemStatsStrip() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {systemStats.map((s) => {
        const max = Math.max(...s.trend);
        return (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-lg border border-border/60 bg-card/50 p-3 backdrop-blur"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {s.label}
              </span>
              <span className="font-display text-lg font-semibold text-primary">{s.value}</span>
            </div>
            <div className="mt-2 flex h-8 items-end gap-1">
              {s.trend.map((v, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-sm bg-primary/60"
                  style={{ height: `${(v / max) * 100}%`, boxShadow: "0 0 8px var(--primary)" }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}