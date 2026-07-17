import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { getAgentFlow, type FlowRun } from "@/lib/agents/flow.functions";

// How long a fully-settled interaction stays highlighted before the tree
// fades back to full standby. Without this, the last-ever completed run
// stays "lit up" forever (even across app restarts), reading as if that
// agent were still working.
const HIGHLIGHT_EXPIRY_MS = 10_000;

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

  // Forces the expiry check below to re-evaluate on a clock even when the
  // polled data hasn't changed (react-query keeps the same array reference
  // via structural sharing when a 3s refetch returns identical rows).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const activeBySlug = useMemo(() => {
    // Referenced only to satisfy the exhaustive-deps lint — its sole job is
    // forcing this memo to re-run periodically so HIGHLIGHT_EXPIRY_MS is
    // actually re-checked against the clock, not just when `runs` changes.
    void tick;
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

    const subtree: FlowRun[] = [];
    const visit = (run: FlowRun) => {
      subtree.push(run);
      for (const child of byParent.get(run.id) ?? []) visit(child);
    };
    visit(root);

    // Fade the whole interaction back to standby once every run in it has
    // settled (nothing still "running") and the most recent finish was
    // more than HIGHLIGHT_EXPIRY_MS ago.
    const stillRunning = subtree.some((r) => r.status === "running");
    if (!stillRunning) {
      const lastFinishedAt = subtree.reduce<number>((max, r) => {
        const t = r.finishedAt ? new Date(r.finishedAt).getTime() : 0;
        return Math.max(max, t);
      }, 0);
      if (lastFinishedAt > 0 && Date.now() - lastFinishedAt > HIGHLIGHT_EXPIRY_MS) {
        pinnedRootId.current = null;
        return map;
      }
    }

    pinnedRootId.current = root.id;
    for (const run of subtree) map.set(run.agentSlug, run);
    return map;
    // `tick` is intentionally in the deps below purely to force periodic
    // re-evaluation of the expiry check on a clock, independent of `runs`.
  }, [runs, tick]);

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
