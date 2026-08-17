// Command-center overview — aggregate stats across the whole agent roster,
// replacing the old per-widget Dashboard. Single accent hue throughout (the
// bar chart is one series — runs per bucket, scoped by the filter row — so
// no legend is needed); status colors (success/warning/destructive) are
// reserved for actual state, never reused as decoration.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { getSystemPulse, type AgentPulseRow } from "@/lib/dashboard/dashboard.functions";
import { cn } from "@/lib/utils";

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "destructive";
}) {
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "destructive"
          ? "var(--destructive)"
          : "var(--foreground)";
  return (
    <div className="min-w-0 flex-1 border-l border-primary/15 pl-3 first:border-l-0 first:pl-0">
      <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </p>
      <p className="font-display mt-1 truncate text-2xl font-bold tracking-wide" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

type Range = "24h" | "7d";

const DAY_LABELS = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];

// Bucket labels, oldest → newest, matching the server's hourlyBuckets/dailyBuckets order.
function bucketLabels(range: Range): string[] {
  const now = new Date();
  if (range === "24h") {
    return Array.from({ length: 24 }, (_, i) => {
      const h = new Date(now.getTime() - (23 - i) * 3600_000).getHours();
      return `${String(h).padStart(2, "0")}:00`;
    });
  }
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() - (6 - i) * 86_400_000);
    return DAY_LABELS[d.getDay()];
  });
}

function RunsChart({ values, range }: { values: number[]; range: Range }) {
  const [hover, setHover] = useState<number | null>(null);
  const labels = useMemo(() => bucketLabels(range), [range]);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="relative">
      <div
        className="flex h-24 items-end gap-[2px]"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${total} uruchomień w wybranym okresie`}
      >
        {values.map((v, i) => {
          const heightPct = v === 0 ? 0 : Math.max(6, (v / max) * 100);
          const isHovered = hover === i;
          return (
            <div
              key={i}
              className="group relative flex h-full min-w-0 flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              {/* Hit target extends the full column height, well past the painted bar. */}
              <div
                className="rounded-[3px] transition-[opacity,background-color]"
                style={{
                  height: `${Math.max(2, heightPct)}%`,
                  width: "100%",
                  background:
                    v === 0
                      ? "color-mix(in oklab, var(--muted-foreground) 25%, transparent)"
                      : isHovered
                        ? "var(--primary)"
                        : "color-mix(in oklab, var(--primary) 70%, transparent)",
                  borderRadius: "3px 3px 1px 1px",
                }}
              />
              {isHovered && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-primary/30 bg-popover px-2 py-1 text-center shadow-lg">
                  <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
                    {labels[i]}
                  </p>
                  <p className="font-mono text-[11px] font-bold text-primary">{v}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[8px] text-muted-foreground/60">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  busy: "var(--warning)",
  error: "var(--destructive)",
  idle: "var(--muted-foreground)",
};

function AgentRow({
  agent,
  active,
  onClick,
}: {
  agent: AgentPulseRow;
  active: boolean;
  onClick: () => void;
}) {
  const color = agent.isEnabled ? (STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle) : "#4b5563";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 border-b border-primary/10 py-1.5 text-left last:border-b-0",
        active && "bg-primary/10",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span
          className={cn(
            "truncate font-display text-[11px] uppercase tracking-[0.12em]",
            active ? "text-primary" : "text-foreground/90",
          )}
        >
          {agent.name}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] text-muted-foreground">
        <span>{agent.runs24h} uruchomień</span>
        <span
          style={{
            color:
              agent.successRate == null
                ? "var(--muted-foreground)"
                : agent.successRate >= 0.9
                  ? "var(--success)"
                  : agent.successRate >= 0.6
                    ? "var(--warning)"
                    : "var(--destructive)",
          }}
        >
          {agent.successRate == null ? "—" : `${Math.round(agent.successRate * 100)}%`}
        </span>
      </div>
    </button>
  );
}

export function SystemPulsePanel({ index = 0 }: { index?: number }) {
  const fetchPulse = useServerFn(getSystemPulse);
  const { data: pulse, isFetching } = useQuery({
    queryKey: ["dashboard", "system-pulse"],
    queryFn: () => fetchPulse(),
    refetchInterval: 15_000,
  });

  const [range, setRange] = useState<Range>("24h");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const chartValues = useMemo(() => {
    if (!pulse) return [];
    if (agentFilter === "all") return range === "24h" ? pulse.sparkline24h : pulse.sparkline7d;
    const agent = pulse.perAgent.find((a) => a.slug === agentFilter);
    if (!agent) return range === "24h" ? pulse.sparkline24h : pulse.sparkline7d;
    return range === "24h" ? agent.sparkline24h : agent.sparkline7d;
  }, [pulse, range, agentFilter]);

  const chartLabel =
    agentFilter === "all"
      ? "Wszyscy agenci"
      : (pulse?.perAgent.find((a) => a.slug === agentFilter)?.name ?? "Wszyscy agenci");

  return (
    <HudPanel
      index={index}
      title="COMMAND // SYSTEM PULSE"
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
      className="p-5"
    >
      {!pulse ? (
        <p className="mt-2 font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          ▸ Ładowanie telemetrii…
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap gap-4">
            <StatTile label="Uruchomienia 24h" value={String(pulse.runs24h)} />
            <StatTile
              label="Skuteczność 24h"
              value={
                pulse.successRate24h == null ? "—" : `${Math.round(pulse.successRate24h * 100)}%`
              }
              tone={
                pulse.successRate24h == null
                  ? undefined
                  : pulse.successRate24h >= 0.9
                    ? "success"
                    : pulse.successRate24h >= 0.6
                      ? "warning"
                      : "destructive"
              }
            />
            <StatTile
              label="Błędy 24h"
              value={String(pulse.errors24h)}
              tone={pulse.errors24h > 0 ? "destructive" : "success"}
            />
            <StatTile
              label="Tokeny 24h"
              value={(pulse.tokensIn24h + pulse.tokensOut24h).toLocaleString("pl-PL")}
            />
            <StatTile label="Agenci aktywni" value={`${pulse.activeAgents}/${pulse.totalAgents}`} />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
                Uruchomienia — {chartLabel}
              </p>
              <div className="flex items-center gap-3">
                <div className="flex overflow-hidden rounded border border-primary/25">
                  {(["24h", "7d"] as Range[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRange(r)}
                      className={cn(
                        "px-2.5 py-1 font-display text-[9px] uppercase tracking-widest transition",
                        range === r
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-primary/10",
                      )}
                    >
                      {r === "24h" ? "24H" : "7D"}
                    </button>
                  ))}
                </div>
                {agentFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setAgentFilter("all")}
                    className="font-display text-[9px] uppercase tracking-widest text-primary/70 hover:text-primary"
                  >
                    × wyczyść filtr
                  </button>
                )}
              </div>
            </div>
            <RunsChart values={chartValues} range={range} />
          </div>

          <div>
            <p className="font-display mb-1 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Roster{" "}
              <span className="normal-case tracking-normal text-muted-foreground/60">
                (kliknij, by przefiltrować wykres)
              </span>
            </p>
            {pulse.perAgent.length === 0 ? (
              <p className="py-2 font-mono text-[10px] text-muted-foreground">brak agentów</p>
            ) : (
              pulse.perAgent.map((a) => (
                <AgentRow
                  key={a.slug}
                  agent={a}
                  active={agentFilter === a.slug}
                  onClick={() => setAgentFilter(agentFilter === a.slug ? "all" : a.slug)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </HudPanel>
  );
}
