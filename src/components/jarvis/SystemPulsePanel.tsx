// Command-center overview — aggregate stats across the whole agent roster,
// replacing the old per-widget Dashboard. Single accent hue throughout (the
// area chart is one series — runs per bucket, scoped by the filter row — so
// no legend is needed); status colors (success/warning/destructive) are
// reserved for actual state, never reused as decoration.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  type TooltipProps,
} from "recharts";
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

type ChartPoint = { label: string; value: number };

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as ChartPoint;
  return (
    <div className="pointer-events-none rounded border border-primary/30 bg-popover px-2 py-1 text-center shadow-lg">
      <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
        {point.label}
      </p>
      <p className="font-mono text-[11px] font-bold text-primary">{point.value}</p>
    </div>
  );
}

function RunsChart({ values, range }: { values: number[]; range: Range }) {
  const labels = useMemo(() => bucketLabels(range), [range]);
  const data = useMemo<ChartPoint[]>(
    () => values.map((value, i) => ({ label: labels[i], value })),
    [values, labels],
  );
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="h-28" role="img" aria-label={`${total} uruchomień w wybranym okresie`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="pulseAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--muted-foreground)" strokeOpacity={0.12} />
          <XAxis
            dataKey="label"
            tick={{
              fontSize: 8,
              fill: "var(--muted-foreground)",
              fontFamily: '"Share Tech Mono", monospace',
            }}
            tickLine={false}
            axisLine={false}
            interval={range === "24h" ? 3 : 0}
            minTickGap={12}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#pulseAreaFill)"
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
            isAnimationActive
            animationDuration={450}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
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
              label="Zdarzenia 24h"
              value={String(pulse.warnEvents24h)}
              tone={pulse.warnEvents24h > 0 ? "warning" : "success"}
            />
            <StatTile
              label="Nieudane uruchomienia 24h"
              value={String(pulse.failedRuns24h)}
              tone={pulse.failedRuns24h > 0 ? "destructive" : "success"}
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
