import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { getAgentFlow, type FlowDelegation, type FlowRun, type FlowToolCall } from "@/lib/agents/flow.functions";
import { describeToolCall } from "./toolDescriptions";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

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

// The most recent tool call is what the agent is doing right now (or just
// finished, one poll's worth of lag behind) — `output.tool_calls` is now
// written incrementally by runOrchestrator after every iteration, not only
// once at the very end, so this is real live progress, not a guess.
function currentActionLine(run: FlowRun): string | null {
  if (run.toolCalls.length === 0) return null;
  const last = run.toolCalls[run.toolCalls.length - 1];
  return describeToolCall(last.name, last.args);
}

function ToolChips({ calls }: { calls: FlowToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="mt-1.5 flex max-w-[220px] flex-wrap justify-center gap-1">
      {calls.map((call, i) => {
        const label = describeToolCall(call.name, call.args);
        return (
          <span
            key={`${call.name}-${i}`}
            title={label}
            className="animate-flow-node-in max-w-[150px] truncate rounded-full border border-primary/20 bg-[color:var(--surface-1)] px-1.5 py-0.5 font-display text-[7px] uppercase tracking-[0.15em] text-primary/70"
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Radial layout: a rotated "spoke" div carries the connecting line + the
// travelling dot in its own local coordinate space (so the dot's simple
// top:0%->100% animation automatically follows whatever angle the spoke
// is rotated to) — the destination TILE itself is a separate, independently
// positioned element (computed via the same trig), not a child of the
// rotated spoke, so its contents never rotate.
function FlowSpoke({ angleDeg, length, active }: { angleDeg: number; length: number; active: boolean }) {
  return (
    <div
      className="absolute left-1/2 top-0 origin-top"
      style={{ width: 2, height: length, transform: `translateX(-1px) rotate(${angleDeg}deg)` }}
    >
      <div
        className="h-full w-full"
        style={{
          background: active
            ? "linear-gradient(to bottom, color-mix(in oklab, var(--primary) 45%, transparent), color-mix(in oklab, var(--primary) 10%, transparent))"
            : "color-mix(in oklab, var(--muted-foreground) 14%, transparent)",
        }}
      />
      {active && (
        <span
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 animate-flow-dot-travel rounded-full"
          style={{ backgroundColor: "var(--primary)", boxShadow: "0 0 6px var(--primary)" }}
        />
      )}
    </div>
  );
}

function FlowNodeTile({
  name,
  run,
  emphasis,
  width,
  selected,
  onClick,
}: {
  name: string;
  run?: FlowRun;
  emphasis?: boolean;
  /** Teammate tiles shrink as the roster grows (see arc geometry notes in
   *  AgentFlowTree) to keep adjacent nodes from overlapping — the
   *  Orchestrator's emphasis tile ignores this and stays fixed-size. */
  width?: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  const active = !!run;
  const color = active ? statusColor(run.status) : IDLE_COLOR;
  const running = run?.status === "running";
  const liveLine = running && run ? currentActionLine(run) : null;
  const statusLine = liveLine
    ? liveLine
    : running
      ? "myśli…"
      : active && run.latencyMs != null
        ? `${run.latencyMs}ms`
        : active
          ? run.status
          : "standby";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border backdrop-blur transition-all duration-500",
        emphasis ? "min-w-[132px] px-4 py-2.5" : "px-2.5 py-1.5",
        selected && "ring-1 ring-primary/60",
      )}
      style={{
        minWidth: emphasis ? undefined : (width ?? 104),
        borderColor: `color-mix(in oklab, ${color} ${active ? 40 : 16}%, transparent)`,
        background: active
          ? "color-mix(in oklab, var(--surface-1) 92%, transparent)"
          : "color-mix(in oklab, var(--surface-1) 55%, transparent)",
        opacity: active ? 1 : 0.5,
        boxShadow: running
          ? `0 0 0 1px color-mix(in oklab, ${color} 20%, transparent), 0 0 ${emphasis ? 22 : 16}px -2px color-mix(in oklab, ${color} 65%, transparent)`
          : active
            ? `0 0 0 1px color-mix(in oklab, ${color} 12%, transparent)`
            : "none",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn("rounded-full", running ? "animate-pulse" : "", emphasis ? "h-2 w-2" : "h-1.5 w-1.5")}
          style={{ backgroundColor: color, boxShadow: active ? `0 0 6px ${color}` : "none" }}
        />
        <span
          className={cn(
            "font-display uppercase tracking-[0.2em] text-foreground/90",
            emphasis ? "text-[12px]" : "text-[10px]",
          )}
        >
          {name}
        </span>
      </div>
      <span
        title={liveLine ?? undefined}
        className="max-w-[150px] truncate font-display text-[8px] uppercase tracking-[0.15em] text-muted-foreground"
      >
        {statusLine}
      </span>
    </button>
  );
}

// Recent-run history for whichever node is currently selected (click to
// toggle) — pure client-side filter over the same `runs` array the tree
// already fetches, so this costs nothing extra server-side.
function RunHistoryPanel({ agentName, runs }: { agentName: string; runs: FlowRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="px-3 py-2 text-center font-display text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        ▸ brak zarejestrowanych uruchomień
      </p>
    );
  }
  return (
    <div className="max-h-[160px] space-y-1 overflow-y-auto px-2 py-2">
      {runs.slice(0, 6).map((r) => {
        const last = r.toolCalls[r.toolCalls.length - 1];
        const delegation = r.delegations[0];
        const summary = delegation
          ? `▸ delegowane do ${delegation.toSlug}: „${delegation.task}"`
          : last
            ? describeToolCall(last.name, last.args)
            : r.toolCalls.length === 0 && r.delegations.length === 0
              ? "brak wywołań narzędzi"
              : "";
        return (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded border border-primary/10 bg-[color:var(--surface-1)]/60 px-2 py-1"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: statusColor(r.status) }}
            />
            <span className="min-w-0 flex-1 truncate text-left font-mono text-[9px] text-muted-foreground" title={summary}>
              {summary}
            </span>
            <span className="shrink-0 font-display text-[8px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {r.latencyMs != null ? `${r.latencyMs}ms` : r.status}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-center font-display text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
        {agentName} · ostatnie {Math.min(runs.length, 6)} uruchomień
      </p>
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
  const isMobile = useIsMobile();

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

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

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

  // All delegations currently in flight/settled for the pinned interaction,
  // shown as a small list under the hub rather than attached to individual
  // spokes — at arbitrary fan angles there's no single "above the node"
  // position that reads naturally for every teammate, but "under the agent
  // that issued them" always does.
  const activeDelegations = useMemo(() => {
    const out: FlowDelegation[] = [];
    for (const run of activeBySlug.values()) out.push(...run.delegations);
    return out;
  }, [activeBySlug]);

  const orchestrator = agents.find((a) => a.slug === "orchestrator");
  const teammates = agents.filter((a) => a.slug !== "orchestrator");
  const orchestratorRun = activeBySlug.get("orchestrator");

  // Fan geometry: teammates arranged on an arc below the hub rather than a
  // full circle — a true 360° layout would force this compact HUD panel
  // much taller than the rest of the dashboard grid to have room for nodes
  // above/beside the hub too. Radius, tile width and arc width all scale
  // together as the roster grows (verified numerically for up to 8
  // teammates — chord distance between adjacent nodes stays >=8% wider
  // than the tile at that size, so future agents like Researcher/Producer
  // spread out and shrink slightly rather than overlapping):
  //   arc half-angle: 50° (1 teammate) growing to a cap of 85°
  //   radius: fixed through 3 teammates, then grows with each extra one
  //   tile width: fixed through 3 teammates, then shrinks with each extra
  const mobileScale = isMobile ? 0.75 : 1;
  const n = teammates.length;
  const arcHalfDeg = Math.min(85, 50 + Math.max(0, n - 1) * 14);
  const radius = (90 + Math.max(0, n - 3) * 20) * mobileScale;
  const teammateTileWidth = Math.max(68, 104 - Math.max(0, n - 3) * 10) * mobileScale;
  const anchorY = 36 * mobileScale;
  const containerHeight = anchorY + radius + (isMobile ? 52 : 62);
  const angleFor = (i: number) => (n <= 1 ? 0 : -arcHalfDeg + (2 * arcHalfDeg * i) / (n - 1));

  const selectedRuns = useMemo(
    () => (selectedSlug ? runs.filter((r) => r.agentSlug === selectedSlug) : []),
    [runs, selectedSlug],
  );
  const selectedAgent = agents.find((a) => a.slug === selectedSlug);

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
      {!orchestrator ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ▸ Ładowanie zespołu agentów…
          </p>
        </div>
      ) : (
        <>
          <div className="relative mx-auto w-full max-w-[420px]" style={{ height: containerHeight }}>
            {teammates.map((t, i) => (
              <FlowSpoke
                key={`spoke-${t.slug}`}
                angleDeg={angleFor(i)}
                length={radius}
                active={activeBySlug.has(t.slug)}
              />
            ))}
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ top: anchorY }}
            >
              <FlowNodeTile
                name={orchestrator.name}
                run={orchestratorRun}
                emphasis
                selected={selectedSlug === "orchestrator"}
                onClick={() => setSelectedSlug((s) => (s === "orchestrator" ? null : "orchestrator"))}
              />
            </div>
            {teammates.map((t, i) => {
              const run = activeBySlug.get(t.slug);
              const angleRad = (angleFor(i) * Math.PI) / 180;
              const dx = radius * Math.sin(angleRad);
              const dy = radius * Math.cos(angleRad);
              return (
                <div
                  key={t.slug}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `calc(50% + ${dx}px)`, top: anchorY + dy }}
                >
                  <FlowNodeTile
                    name={t.name}
                    run={run}
                    width={teammateTileWidth}
                    selected={selectedSlug === t.slug}
                    onClick={() => setSelectedSlug((s) => (s === t.slug ? null : t.slug))}
                  />
                  {run && <ToolChips calls={run.toolCalls} />}
                </div>
              );
            })}
          </div>

          {activeDelegations.length > 0 && (
            <div className="mx-auto mt-1 flex max-w-[380px] flex-col items-center gap-1">
              {activeDelegations.map((d, i) => (
                <span
                  key={`${d.toSlug}-${i}`}
                  title={d.task}
                  className="animate-flow-node-in max-w-full truncate font-display text-[8px] uppercase tracking-[0.12em] text-primary/80"
                >
                  ▸ deleguje do {d.toSlug}: „{d.task}"
                </span>
              ))}
            </div>
          )}

          {selectedSlug && selectedAgent && (
            <div className="mt-2 rounded-lg border border-primary/20 bg-[color:var(--surface-1)]/70">
              <RunHistoryPanel agentName={selectedAgent.name} runs={selectedRuns} />
            </div>
          )}
        </>
      )}
    </HudPanel>
  );
}
