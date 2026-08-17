// Command-center overview — aggregate stats across the whole agent roster,
// replacing the old per-widget Dashboard. Single accent hue throughout (the
// sparkline is one series — runs/hour, all agents combined — so no legend
// is needed); status colors (success/warning/destructive) are reserved for
// actual state, never reused as decoration.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { getSystemPulse, type AgentPulseRow } from "@/lib/dashboard/dashboard.functions";

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

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className="min-w-[3px] flex-1 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  busy: "var(--warning)",
  error: "var(--destructive)",
  idle: "var(--muted-foreground)",
};

function AgentRow({ agent }: { agent: AgentPulseRow }) {
  const color = agent.isEnabled ? (STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle) : "#4b5563";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-primary/10 py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span className="truncate font-display text-[11px] uppercase tracking-[0.12em] text-foreground/90">
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
    </div>
  );
}

export function SystemPulsePanel({ index = 0 }: { index?: number }) {
  const fetchPulse = useServerFn(getSystemPulse);
  const { data: pulse, isFetching } = useQuery({
    queryKey: ["dashboard", "system-pulse"],
    queryFn: () => fetchPulse(),
    refetchInterval: 15_000,
  });

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
            <p className="font-display mb-1.5 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Uruchomienia / godzina (24h)
            </p>
            <Sparkline values={pulse.sparkline} />
          </div>

          <div>
            <p className="font-display mb-1 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Roster
            </p>
            {pulse.perAgent.length === 0 ? (
              <p className="py-2 font-mono text-[10px] text-muted-foreground">brak agentów</p>
            ) : (
              pulse.perAgent.map((a) => <AgentRow key={a.slug} agent={a} />)
            )}
          </div>
        </div>
      )}
    </HudPanel>
  );
}
