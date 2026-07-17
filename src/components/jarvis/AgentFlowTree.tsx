import { useMemo, useRef } from "react";
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
const IDLE_COLOR = "var(--muted-foreground)";

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? STATUS_COLOR.pending;
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

function FlowNodeTile({ name, run }: { name: string; run?: FlowRun }) {
  const active = !!run;
  const color = active ? statusColor(run.status) : IDLE_COLOR;
  const running = run?.status === "running";
  return (
    <div
      className="flex min-w-[112px] flex-col items-center gap-1 rounded-lg border px-3 py-2 backdrop-blur transition-all duration-500"
      style={{
        borderColor: `color-mix(in oklab, ${color} ${active ? 40 : 16}%, transparent)`,
        background: active
          ? "color-mix(in oklab, var(--surface-1) 92%, transparent)"
          : "color-mix(in oklab, var(--surface-1) 55%, transparent)",
        opacity: active ? 1 : 0.5,
        boxShadow: running
          ? `0 0 0 1px color-mix(in oklab, ${color} 20%, transparent), 0 0 16px -2px color-mix(in oklab, ${color} 65%, transparent)`
          : active
            ? `0 0 0 1px color-mix(in oklab, ${color} 12%, transparent)`
            : "none",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse" : ""}`}
          style={{ backgroundColor: color, boxShadow: active ? `0 0 6px ${color}` : "none" }}
        />
        <span className="font-display text-[10px] uppercase tracking-[0.2em] text-foreground/90">
          {name}
        </span>
      </div>
      <span className="font-display text-[8px] uppercase tracking-[0.15em] text-muted-foreground">
        {running
          ? "processing…"
          : active && run.latencyMs != null
            ? `${run.latencyMs}ms`
            : active
              ? run.status
              : "standby"}
      </span>
    </div>
  );
}

function FlowStem({ active }: { active: boolean }) {
  return (
    <div
      className="relative h-4 w-px"
      style={{
        background: active
          ? "color-mix(in oklab, var(--primary) 40%, transparent)"
          : "color-mix(in oklab, var(--muted-foreground) 16%, transparent)",
      }}
    >
      {active && (
        <span
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 animate-flow-dot-travel rounded-full"
          style={{ backgroundColor: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
        />
      )}
    </div>
  );
}

export function AgentFlowTree({ index = 0 }: { index?: number }) {
  const fetchFlow = useServerFn(getAgentFlow);
  const { data, isFetching } = useQuery({
    queryKey: ["agents", "flow"],
    queryFn: () => fetchFlow(),
    refetchInterval: 3000,
  });
  const agents = data?.agents ?? [];
  const runs = useMemo(() => data?.runs ?? [], [data]);

  // Sticks with the currently displayed interaction across polls instead of
  // recomputing "latest" from scratch each time — a child run's own
  // createdAt briefly being the max in the fetched set must not flip the
  // highlighted path to a different interaction mid-delegation.
  const pinnedRootId = useRef<string | null>(null);

  const activeBySlug = useMemo(() => {
    const map = new Map<string, FlowRun>();
    if (runs.length === 0) return map;
    const byId = new Map(runs.map((r) => [r.id, r]));
    const byParent = new Map<string, FlowRun[]>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      const list = byParent.get(r.parentRunId) ?? [];
      list.push(r);
      byParent.set(r.parentRunId, list);
    }

    const roots = runs.filter((r) => !r.parentRunId);
    const newestRoot = roots.reduce<FlowRun | null>(
      (a, b) => (!a || b.createdAt > a.createdAt ? b : a),
      null,
    );
    const pinned = pinnedRootId.current ? byId.get(pinnedRootId.current) : undefined;
    const root =
      pinned &&
      (!newestRoot || newestRoot.id === pinned.id || newestRoot.createdAt <= pinned.createdAt)
        ? pinned
        : newestRoot;
    if (!root) return map;
    pinnedRootId.current = root.id;

    const visit = (run: FlowRun) => {
      map.set(run.agentSlug, run);
      for (const child of byParent.get(run.id) ?? []) visit(child);
    };
    visit(root);
    return map;
  }, [runs]);

  const orchestrator = agents.find((a) => a.slug === "orchestrator");
  const teammates = agents.filter((a) => a.slug !== "orchestrator");
  const anyTeammateActive = teammates.some((t) => activeBySlug.has(t.slug));
  const orchestratorRun = activeBySlug.get("orchestrator");

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
        {!orchestrator ? (
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ▸ Ładowanie zespołu agentów…
          </p>
        ) : (
          <div className="flex flex-col items-center">
            <FlowNodeTile name={orchestrator.name} run={orchestratorRun} />
            {orchestratorRun && <ToolChips calls={orchestratorRun.toolCalls} />}
            {teammates.length > 0 && (
              <>
                <FlowStem active={anyTeammateActive} />
                <div
                  className="inline-flex items-start gap-6 border-t"
                  style={{
                    borderColor: anyTeammateActive
                      ? "color-mix(in oklab, var(--primary) 30%, transparent)"
                      : "color-mix(in oklab, var(--muted-foreground) 16%, transparent)",
                  }}
                >
                  {teammates.map((t) => {
                    const run = activeBySlug.get(t.slug);
                    return (
                      <div key={t.slug} className="flex flex-col items-center">
                        <FlowStem active={!!run} />
                        <FlowNodeTile name={t.name} run={run} />
                        {run && <ToolChips calls={run.toolCalls} />}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </HudPanel>
  );
}
