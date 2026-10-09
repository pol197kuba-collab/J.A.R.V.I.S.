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
import {
  BOARD_SPOTS,
  MEETING_HEAD,
  MEETING_SEATS,
  VISIT,
  isTownAgent,
  type TownSlug,
} from "./townMap";
import { iconForTool } from "./townArt";
import { accepted } from "./townTalk";
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
  /** A finished request's answer, pinned on the board as a note to read. */
  resultReady: (runId: string, ok: boolean, text: string) => void;
  name: (slug: TownSlug) => string;
};

/** Too many queued errands → skip the walk, keep the bubble. */
const BACKLOG_LIMIT = 3;

/**
 * J.A.R.V.I.S. delegates one task at a time (tools run in sequence), so the
 * first hand-off is a walk to the colleague's room. A second delegation in
 * the same request turns it into a meeting: everyone involved gathers at the
 * Core table and stays seated until his run finishes. Pure (tested).
 */
export function isMeeting(delegatesSoFar: number) {
  return delegatesSoFar >= 2;
}

export class TownDirector {
  private snapshot: RunSnapshot | null = null;
  private boardSlot = 0;
  /** Parent run id → agents it delegated to, in order. */
  private delegates = new Map<string, TownSlug[]>();
  /** Parent run ids whose delegations became a meeting at the table. */
  private meetings = new Set<string>();
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
        if (parent === "jarvis" && e.parent && this.joinMeeting(e.parent.id, slug, e.task)) return;
        if (!parent || parent === slug || w.backlog(parent) >= BACKLOG_LIMIT) {
          w.say(slug, e.task, 2400, "mail");
          return;
        }
        // call them back to their desk now, so they're in when we arrive
        w.recall(slug);
        void w.actor(parent, async () => {
          await w.walkTo(parent, VISIT[slug]);
          await w.untilHome(slug, 6000);
          w.faceEachOther(parent, slug);
          w.say(parent, e.task, 2400, "mail");
          await w.wait(1200);
          w.say(slug, accepted(slug), 1100, "check", "ok");
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
        this.endMeeting(e.run.id);
        const msg = e.ok ? "Gotowe" : "Błąd";
        h.log(slug, `${h.name(slug)} ${e.ok ? "skończył" : "zgłasza błąd"}`);
        if (!e.run.parentRunId && slug === "jarvis") {
          h.commandFinished(e.run.id, e.ok);
          const reply = h.latestReply();
          const text = !e.ok
            ? "Coś poszło nie tak, szczegóły w czacie"
            : (reply ?? "Gotowe, odpowiedź w czacie");
          h.resultReady(e.run.id, e.ok, text);
          if (w.backlog("jarvis") >= BACKLOG_LIMIT) {
            w.say("jarvis", text, 2800, e.ok ? "check" : "cross", e.ok ? "ok" : "bad");
            return;
          }
          if (w.walkMode) {
            // you're out walking — he pins the answer on the board for you
            void w.actor("jarvis", async () => {
              await w.walkTo("jarvis", VISIT.jarvis);
              w.face("jarvis", "up");
              w.say("jarvis", "Wynik czeka na tablicy!", 2600, "pin", e.ok ? "ok" : "bad");
              await w.wait(1500);
              await w.goHome("jarvis");
            });
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

  /**
   * Track a delegation; from the second one on, hold it at the Core table.
   * Returns true when the meeting took care of the hand-off.
   */
  private joinMeeting(parentRunId: string, slug: TownSlug, task: string): boolean {
    const w = this.world;
    const list = this.delegates.get(parentRunId) ?? [];
    if (!list.includes(slug)) list.push(slug);
    this.delegates.set(parentRunId, list);
    if (!isMeeting(list.length)) return false;
    const seatOf = (s: TownSlug) => MEETING_SEATS[list.indexOf(s) % MEETING_SEATS.length];
    if (!this.meetings.has(parentRunId)) {
      this.meetings.add(parentRunId);
      this.hooks.log(
        "jarvis",
        `Narada w Rdzeniu: ${list.map((s) => this.hooks.name(s)).join(", ")}`,
      );
      w.seat("jarvis", MEETING_HEAD, "right");
      for (const s of list) w.seat(s, seatOf(s), "up");
      void w.actor("jarvis", async () => {
        if (!this.meetings.has(parentRunId)) return;
        await w.goHome("jarvis");
        w.face("jarvis", "right");
        w.say("jarvis", "Narada! Zbierzcie się przy stole.", 2400, "mail");
        await w.wait(1200);
      });
    } else w.seat(slug, seatOf(slug), "up");
    void w.actor("jarvis", async () => {
      // the request may already be over by the time this errand comes up
      if (!this.meetings.has(parentRunId)) return;
      await w.goHome("jarvis");
      await w.untilHome(slug, 8000);
      w.faceEachOther("jarvis", slug);
      w.say("jarvis", task, 2400, "mail");
      await w.wait(1200);
      w.say(slug, accepted(slug), 1100, "check", "ok");
      await w.wait(500);
      w.face("jarvis", "right");
      w.face(slug, "up");
    });
    return true;
  }

  /** The delegating run finished: the meeting (if any) breaks up. */
  private endMeeting(runId: string) {
    const list = this.delegates.get(runId);
    if (!list) return;
    this.delegates.delete(runId);
    if (!this.meetings.delete(runId)) return;
    this.world.release(["jarvis", ...list]);
  }
}
