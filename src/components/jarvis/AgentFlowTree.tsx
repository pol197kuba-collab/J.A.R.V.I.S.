import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import {
  getAgentFlow,
  type FlowDelegation,
  type FlowRun,
  type FlowToolCall,
} from "@/lib/agents/flow.functions";
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

// `maxWidth` is derived from the actual horizontal gap between this node
// and its neighbors (`spacing` in the main component), NOT a fixed
// constant — a hardcoded 180px container centered on a node whose
// neighbors sit only ~76px away (the common case at today's roster size)
// structurally spills chip content into the neighbor's own label column.
// Capping to a safe fraction of the real gap keeps chips inside this
// node's own "lane" regardless of how tight the layout gets as more
// teammates are added.
function ToolChips({ calls, maxWidth }: { calls: FlowToolCall[]; maxWidth: number }) {
  if (calls.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-1" style={{ maxWidth }}>
      {calls.map((call, i) => {
        const label = describeToolCall(call.name, call.args);
        return (
          <span
            key={`${call.name}-${i}`}
            title={label}
            className="animate-flow-node-in truncate rounded-full border border-primary/20 bg-[color:var(--surface-1)] px-1.5 py-0.5 font-display text-[7px] uppercase tracking-[0.15em] text-primary/70"
            style={{ maxWidth }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Same SVG structure as MiniArcReactor.tsx (three rotating triangles, two
// rings, pulsing core) — that component is hardcoded to `--primary` via
// Tailwind's text-primary/bg-primary, which can't be retinted per node
// status (green=done, red=error, grey=idle) without fragile CSS-variable
// shadowing, so this is a small, purpose-built sibling with the same look
// but color/size as explicit props. Reuses the exact same keyframes
// (animate-mini-reactor-spin / animate-pulse-core) — no new CSS needed.
function ReactorBadge({ size, color, active }: { size: number; color: string; active: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg
        viewBox="0 0 100 100"
        className="animate-mini-reactor-spin absolute inset-0 h-full w-full"
        style={{
          color,
          opacity: active ? 1 : 0.4,
          filter: active ? `drop-shadow(0 0 ${Math.max(3, size * 0.1)}px ${color})` : undefined,
        }}
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.4"
        />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeDasharray="2 3"
          opacity="0.7"
        />
        {[0, 120, 240].map((rot) => (
          <g
            key={rot}
            transform={`rotate(${rot} 50 50)`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          >
            <polygon points="50,18 70,55 30,55" />
          </g>
        ))}
      </svg>
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
          active && "animate-pulse-core",
        )}
        style={{
          width: Math.max(4, size * 0.13),
          height: Math.max(4, size * 0.13),
          backgroundColor: color,
          boxShadow: active ? `0 0 ${size * 0.18}px ${color}` : "none",
        }}
      />
    </div>
  );
}

// A straight connector between the hub and a node, rotated + scaled to
// point exactly at wherever that node's independently-computed (dx, dy)
// position ends up (see the layout notes in AgentFlowTree) — the
// travelling dot's simple top:0%→100% animation lives in the connector's
// own rotated local coordinate space, so it automatically follows
// whatever angle/length the connector has without any per-node math of
// its own.
function FlowSpoke({
  angleDeg,
  length,
  active,
  top,
}: {
  angleDeg: number;
  length: number;
  active: boolean;
  top: number;
}) {
  return (
    <div
      className="absolute left-1/2 origin-top"
      style={{
        width: 2,
        height: length,
        top,
        transform: `translateX(-1px) rotate(${angleDeg}deg)`,
      }}
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

function FlowNode({
  name,
  run,
  badgeSize,
  selected,
  onClick,
}: {
  name: string;
  run?: FlowRun;
  badgeSize: number;
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
      className="flex flex-col items-center gap-1 bg-transparent"
    >
      <div
        className="flex items-center justify-center rounded-full transition-all duration-500"
        style={{
          boxShadow: selected
            ? `0 0 0 2px color-mix(in oklab, var(--primary) 70%, transparent), 0 0 0 4px color-mix(in oklab, var(--surface-1) 92%, transparent)`
            : "none",
        }}
      >
        <ReactorBadge size={badgeSize} color={color} active={active} />
      </div>
      <span
        className="max-w-[110px] truncate font-display uppercase tracking-[0.18em] text-foreground/90"
        style={{ fontSize: badgeSize >= 60 ? 11 : 9 }}
      >
        {name}
      </span>
      <span
        title={liveLine ?? undefined}
        className="max-w-[130px] truncate font-display text-[8px] uppercase tracking-[0.15em] text-muted-foreground"
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
            <span
              className="min-w-0 flex-1 truncate text-left font-mono text-[9px] text-muted-foreground"
              title={summary}
            >
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
  // spokes — at arbitrary fan positions there's no single "above the node"
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

  // Layout: horizontal spacing and vertical drop are computed independently
  // of each other (NOT a shared radius/angle pair) — an earlier version
  // used pure circular trig (shared radius, only angle varying), which
  // looked fine on paper but broke live on a wide mobile viewport: at wide
  // angles cos(angle) shrinks toward 0, so outer teammates barely dropped
  // below the hub at all and visually rode up beside/onto it. Decoupling
  // dx (horizontal spread, evenly spaced by construction — can never
  // collide sideways) from dy (vertical drop, floored at
  // hubRadius+nodeRadius+margin — can never ride up into the hub) makes
  // both failure modes structurally impossible rather than something to
  // keep re-tuning by eye. Verified numerically for up to 8 teammates
  // with real margin (~20-30% headroom above the strict minimum) before
  // shipping.
  const mobileScale = isMobile ? 0.75 : 1;
  const n = teammates.length;
  const orchRadius = 40 * mobileScale;
  const teammateRadius = Math.max(18, 28 - Math.max(0, n - 4) * 2) * mobileScale;
  const spacing = (teammateRadius * 2 + 20) * 1; // teammateRadius already scaled
  const baseDy = orchRadius + teammateRadius + 22 * mobileScale;
  const bow = 22 * mobileScale;
  const totalWidth = n > 1 ? spacing * (n - 1) : 0;
  const teammatePositions = teammates.map((_t, i) => {
    const dx = n > 1 ? -totalWidth / 2 + spacing * i : 0;
    const norm = n > 1 && totalWidth > 0 ? dx / (totalWidth / 2) : 0;
    const dy = baseDy + bow * norm * norm;
    return { dx, dy };
  });
  const anchorY = orchRadius + 14 * mobileScale;
  const maxDy = teammatePositions.reduce((m, p) => Math.max(m, p.dy), 0);
  // +26 reserves room for an active node's ToolChips row so it doesn't get
  // clipped against the panel's own bottom edge — chips are optional
  // (only render for a node with tool calls), so this is a flat buffer
  // rather than something computed per-render.
  const containerHeight = anchorY + maxDy + (isMobile ? 46 : 54) + 26;
  // See the ToolChips definition above: without this, a node's chip row
  // (previously a fixed 180px, centered on that node) spills into a
  // neighbor's label column whenever neighbors sit closer together than
  // ~180px apart — true today at n=3 (spacing is 76px). Scales down
  // automatically as the roster grows and nodes pack tighter.
  const chipsMaxWidth = n > 1 ? Math.max(60, Math.min(180, spacing * 0.85)) : 180;

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
          <div
            className="relative mx-auto w-full max-w-[440px]"
            style={{ height: containerHeight }}
          >
            {teammates.map((t, i) => {
              const { dx, dy } = teammatePositions[i];
              const dist = Math.hypot(dx, dy);
              const angleDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
              return (
                <FlowSpoke
                  key={`spoke-${t.slug}`}
                  angleDeg={angleDeg}
                  length={dist}
                  active={activeBySlug.has(t.slug)}
                  top={anchorY}
                />
              );
            })}
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ top: anchorY }}
            >
              <FlowNode
                name={orchestrator.name}
                run={orchestratorRun}
                badgeSize={orchRadius * 2}
                selected={selectedSlug === "orchestrator"}
                onClick={() =>
                  setSelectedSlug((s) => (s === "orchestrator" ? null : "orchestrator"))
                }
              />
            </div>
            {teammates.map((t, i) => {
              const run = activeBySlug.get(t.slug);
              const { dx, dy } = teammatePositions[i];
              return (
                <div
                  key={t.slug}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `calc(50% + ${dx}px)`, top: anchorY + dy }}
                >
                  <FlowNode
                    name={t.name}
                    run={run}
                    badgeSize={teammateRadius * 2}
                    selected={selectedSlug === t.slug}
                    onClick={() => setSelectedSlug((s) => (s === t.slug ? null : t.slug))}
                  />
                  {run && <ToolChips calls={run.toolCalls} maxWidth={chipsMaxWidth} />}
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
