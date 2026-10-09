// Agent Town — turns the real agent activity (the same agent_runs feed the
// delegation tree reads, via getAgentFlow) into things the characters do:
//
//   new delegated run      → the parent walks to the child's room and hands
//                            over the task; the child goes to work
//   new root J.A.R.V.I.S.  → he takes the oldest command pinned on the board
//   new tool call          → a speech bubble with the tool and its icon
//   run finished           → the agent brings the result to the board;
//                            a finished root run goes back to your terminal
//
// diffFlow() is pure (tested); TownDirector applies its events to a world.

import type { FlowResult, FlowRun } from "@/lib/agents/flow.functions";
import { BOARD_SPOTS, VISIT, isTownAgent, type TownSlug } from "./townMap";
import { iconForTool } from "./townArt";
import type { CharStatus, TownWorld } from "./townWorld";

export type RunSnapshot = Map<string, { status: string; tools: number }>;

export type TownEvent =
  | { type: "started"; run: FlowRun }
  | { type: "delegated"; run: FlowRun; parent: FlowRun | null; task: string }
  | { type: "tool"; run: FlowRun; tool: string }
  | { type: "finished"; run: FlowRun; ok: boolean };

const ACTIVE = new Set(["running", "pending"]);
export const isActive = (status: string) => ACTIVE.has(status);

export function snapshotRuns(runs: readonly FlowRun[]): RunSnapshot {
  return new Map(runs.map((r) => [r.id, { status: r.status, tools: r.toolCalls.length }]));
}

/**
 * Events between two polls, oldest first. The first poll (prev === null)
 * only establishes a baseline: history is not replayed as animation.
 */
export function diffFlow(prev: RunSnapshot | null, runs: readonly FlowRun[]): TownEvent[] {
  if (!prev) return [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  const events: TownEvent[] = [];
  const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const run of ordered) {
    const before = prev.get(run.id);
    if (!before) {
      if (run.parentRunId) {
        const parent = byId.get(run.parentRunId) ?? null;
        const task =
          parent?.delegations.find((d) => d.toSlug === run.agentSlug)?.task?.trim() ||
          "Nowe zadanie";
        events.push({ type: "delegated", run, parent, task });
      } else events.push({ type: "started", run });
      const last = run.toolCalls[run.toolCalls.length - 1];
      if (last) events.push({ type: "tool", run, tool: last.name });
      if (!isActive(run.status)) events.push({ type: "finished", run, ok: run.status !== "error" });
      continue;
    }
    if (run.toolCalls.length > before.tools) {
      events.push({ type: "tool", run, tool: run.toolCalls[run.toolCalls.length - 1].name });
    }
    if (isActive(before.status) && !isActive(run.status)) {
      events.push({ type: "finished", run, ok: run.status !== "error" });
    }
  }
  return events;
}

/** What each character should look like, from the runs + the agent roster. */
export function characterStatus(
  slug: TownSlug,
  runs: readonly FlowRun[],
  enabled: boolean | undefined,
  now: number,
): CharStatus {
  if (enabled === false) return "off";
  const mine = runs.filter((r) => r.agentSlug === slug);
  if (mine.some((r) => isActive(r.status))) return "running";
  const last = mine.reduce<FlowRun | null>(
    (a, r) => (!a || r.createdAt > a.createdAt ? r : a),
    null,
  );
  if (!last?.finishedAt) return "idle";
  const age = now - Date.parse(last.finishedAt);
  if (last.status === "error" && age < 90_000) return "error";
  if (age < 8_000) return "done";
  return "idle";
}

export type TownCommand = {
  id: string;
  text: string;
  target: TownSlug | "auto";
  createdAt: number;
  runId: string | null;
  state: "pending" | "running" | "done" | "error";
};

export type DirectorHooks = {
  log: (slug: TownSlug, text: string) => void;
  /** Oldest command not yet matched to a run, if any. */
  takeCommand: (runId: string) => TownCommand | null;
  commandFinished: (runId: string, ok: boolean) => void;
  /** The newest J.A.R.V.I.S. reply in the chat, for the hand-back bubble. */
  latestReply: () => string | null;
  name: (slug: TownSlug) => string;
};

/** Too many queued errands → skip the walk, keep the bubble. */
const BACKLOG_LIMIT = 3;

export class TownDirector {
  private snapshot: RunSnapshot | null = null;
  private boardSlot = 0;
  constructor(
    private world: TownWorld,
    private hooks: DirectorHooks,
  ) {}

  ingest(flow: FlowResult) {
    const events = diffFlow(this.snapshot, flow.runs);
    this.snapshot = snapshotRuns(flow.runs);
    for (const e of events) this.apply(e);
  }

  private slugOf(run: FlowRun): TownSlug | null {
    return isTownAgent(run.agentSlug) ? run.agentSlug : null;
  }

  private apply(e: TownEvent) {
    const w = this.world;
    const h = this.hooks;
    const slug = this.slugOf(e.run);
    if (!slug) return;
    switch (e.type) {
      case "started": {
        const cmd = slug === "jarvis" ? h.takeCommand(e.run.id) : null;
        const label = cmd?.text ?? "nowe polecenie";
        h.log(slug, `${h.name(slug)} bierze zadanie: „${label}”`);
        if (w.backlog(slug) >= BACKLOG_LIMIT || slug !== "jarvis") {
          w.say(slug, label, 2400, "pin");
          return;
        }
        void w.actor(slug, async () => {
          await w.walkTo(slug, VISIT.jarvis);
          w.face(slug, "up");
          w.say(slug, "Biorę: " + label, 2000, "pin");
          await w.wait(1300);
          await w.goHome(slug);
        });
        return;
      }
      case "delegated": {
        const parent = e.parent ? this.slugOf(e.parent) : null;
        h.log(slug, `${parent ? h.name(parent) : "Ktoś"} → ${h.name(slug)}: „${e.task}”`);
        if (!parent || parent === slug || w.backlog(parent) >= BACKLOG_LIMIT) {
          w.say(slug, e.task, 2400, "mail");
          return;
        }
        void w.actor(parent, async () => {
          await w.walkTo(parent, VISIT[slug]);
          w.say(parent, e.task, 2400, "mail");
          await w.wait(1200);
          w.say(slug, "Przyjąłem!", 1100, "check", "ok");
          await w.wait(600);
          void w.goHome(parent);
        });
        return;
      }
      case "tool": {
        h.log(slug, `${h.name(slug)} · ${e.tool}`);
        w.say(slug, e.tool, 2600, iconForTool(e.tool), "tool");
        return;
      }
      case "finished": {
        const msg = e.ok ? "Gotowe" : "Błąd";
        h.log(slug, `${h.name(slug)} ${e.ok ? "skończył" : "zgłasza błąd"}`);
        if (!e.run.parentRunId && slug === "jarvis") {
          h.commandFinished(e.run.id, e.ok);
          const reply = h.latestReply();
          const text = !e.ok
            ? "Coś poszło nie tak, szczegóły w czacie"
            : (reply ?? "Gotowe, odpowiedź w czacie");
          if (w.backlog("jarvis") >= BACKLOG_LIMIT) {
            w.say("jarvis", text, 2800, e.ok ? "check" : "cross", e.ok ? "ok" : "bad");
            return;
          }
          void w.actor("jarvis", async () => {
            await w.walkTo("jarvis", VISIT.user);
            w.face("jarvis", "left");
            w.say("jarvis", text, 3000, e.ok ? "check" : "cross", e.ok ? "ok" : "bad");
            await w.wait(1600);
            w.say("user", "Dzięki!", 1200);
            await w.wait(500);
            await w.goHome("jarvis");
          });
          return;
        }
        if (w.backlog(slug) >= BACKLOG_LIMIT) {
          w.say(slug, msg, 2200, e.ok ? "check" : "cross", e.ok ? "ok" : "bad");
          return;
        }
        const spot = BOARD_SPOTS[this.boardSlot++ % BOARD_SPOTS.length];
        void w.actor(slug, async () => {
          await w.walkTo(slug, spot);
          w.face(slug, "up");
          w.say(slug, msg, 2200, e.ok ? "check" : "cross", e.ok ? "ok" : "bad");
          await w.wait(1500);
          await w.goHome(slug);
        });
        return;
      }
    }
  }
}
