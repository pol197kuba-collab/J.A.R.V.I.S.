import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { getAgentFlow, type FlowRun } from "@/lib/agents/flow.functions";

const STATUS_COLOR: Record<string, string> = {
  running: "var(--primary)",
  done: "var(--success)",
  error: "var(--destructive)",
  pending: "var(--muted-foreground)",
};

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? STATUS_COLOR.pending;
}

/** Walks parentRunId links (within the fetched window) to the topmost ancestor. */
function findRoot(run: FlowRun, byId: Map<string, FlowRun>): FlowRun {
  let current = run;
  while (current.parentRunId) {
    const parent = byId.get(current.parentRunId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function ToolChips({ calls }: { calls: string[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap justify-center gap-1">
      {calls.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="animate-flow-node-in rounded-full border border-primary/20 bg-[color:var(--surface-1)] px-1.5 py-0.5 font-display text-[7px] uppercase tracking-[0.18em] text-primary/70"
        >
          {name.replace(/^tool\./, "").replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function FlowNodeTile({ run }: { run: FlowRun }) {
  const color = statusColor(run.status);
  const running = run.status === "running";
  return (
    <div
      className="animate-flow-node-in flex min-w-[112px] flex-col items-center gap-1 rounded-lg border px-3 py-2 backdrop-blur transition-shadow"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: "color-mix(in oklab, var(--surface-1) 92%, transparent)",
        boxShadow: running
          ? `0 0 0 1px color-mix(in oklab, ${color} 20%, transparent), 0 0 16px -2px color-mix(in oklab, ${color} 65%, transparent)`
          : `0 0 0 1px color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse" : ""}`}
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span className="font-display text-[10px] uppercase tracking-[0.2em] text-foreground/90">
          {run.agentName}
        </span>
      </div>
      <span className="font-display text-[8px] uppercase tracking-[0.15em] text-muted-foreground">
        {running ? "processing…" : run.latencyMs != null ? `${run.latencyMs}ms` : run.status}
      </span>
    </div>
  );
}

function FlowStem({ active }: { active: boolean }) {
  return (
    <div className="relative h-4 w-px bg-primary/25">
      {active && (
        <span
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 animate-flow-dot-travel rounded-full"
          style={{ backgroundColor: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
        />
      )}
    </div>
  );
}

function FlowBranch({ run, byParent }: { run: FlowRun; byParent: Map<string, FlowRun[]> }) {
  const kids = byParent.get(run.id) ?? [];
  return (
    <div className="flex flex-col items-center">
      <FlowNodeTile run={run} />
      <ToolChips calls={run.toolCalls} />
      {kids.length > 0 && (
        <>
          <FlowStem active={kids.some((k) => k.status === "running")} />
          <div className="inline-flex items-start gap-6 border-t border-primary/20">
            {kids.map((k) => (
              <div key={k.id} className="flex flex-col items-center">
                <FlowStem active={k.status === "running"} />
                <FlowBranch run={k} byParent={byParent} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AgentFlowTree({ index = 0 }: { index?: number }) {
  const fetchFlow = useServerFn(getAgentFlow);
  const { data: runs = [], isFetching } = useQuery({
    queryKey: ["agents", "flow"],
    queryFn: () => fetchFlow(),
    refetchInterval: 3000,
  });

  const tree = useMemo(() => {
    if (runs.length === 0) return null;
    const byId = new Map(runs.map((r) => [r.id, r]));
    const byParent = new Map<string, FlowRun[]>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      const list = byParent.get(r.parentRunId) ?? [];
      list.push(r);
      byParent.set(r.parentRunId, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    // Latest interaction = topmost ancestor of the most recently created run.
    const latest = runs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const root = findRoot(latest, byId);
    return { root, byParent };
  }, [runs]);

  return (
    <HudPanel
      index={index}
      tone="quiet"
      title="AGENT FLOW // DELEGATION TREE"
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
      className="p-4 landscape:max-md:p-2"
    >
      <div className="flex min-h-[120px] items-center justify-center overflow-x-auto py-4">
        {tree ? (
          <FlowBranch run={tree.root} byParent={tree.byParent} />
        ) : (
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ▸ Brak aktywności — zadaj pytanie, aby zobaczyć przepływ delegacji
          </p>
        )}
      </div>
    </HudPanel>
  );
}
