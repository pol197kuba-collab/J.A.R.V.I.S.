// Agent Town — turns the real agent activity (the same agent_runs feed the
// delegation tree reads, via getAgentFlow) into things the characters do:
//
//   new delegated run      → the parent walks to the child's room and hands
//                            over the task; the child goes to work
//   new root J.A.R.V.I.S.  → he takes the oldest command pinned on the board
//   new tool call          → a speech bubble with the tool and its icon
//   run finished           → a delegated agent walks the result back to
//                            J.A.R.V.I.S.; a finished root run goes to your
//                            terminal, and only then does the dog fetch it
//
// diffFlow() is pure (tested); TownDirector applies its events to a world as
// *scenes* that play strictly one after another (see townScenes.ts), so a
// request that finished within one poll still reads as a story.

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
import { PACE, SceneQueue, workHold } from "./townScenes";
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
 * Events between two polls, in narrative order. The first poll (prev === null)
 * only establishes a baseline: history is not replayed as animation.
 *
 * Runs are walked in creation order, which puts a parent's "finished" before
 * its child's "delegated" — backwards as a story. So every "finished" is held
 * back and appended last, in the order the runs really finished (a child
 * always before the parent that was waiting for it).
 */
export function diffFlow(prev: RunSnapshot | null, runs: readonly FlowRun[]): TownEvent[] {
  if (!prev) return [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  const events: TownEvent[] = [];
  const done: TownEvent[] = [];
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
      if (!isActive(run.status)) done.push({ type: "finished", run, ok: run.status !== "error" });
      continue;
    }
    if (run.toolCalls.length > before.tools) {
      events.push({ type: "tool", run, tool: run.toolCalls[run.toolCalls.length - 1].name });
    }
    if (isActive(before.status) && !isActive(run.status)) {
      done.push({ type: "finished", run, ok: run.status !== "error" });
    }
  }
  const endedAt = (e: TownEvent) => e.run.finishedAt ?? e.run.createdAt;
  done.sort(
    (a, b) =>
      endedAt(a).localeCompare(endedAt(b)) || b.run.createdAt.localeCompare(a.run.createdAt),
  );
  return [...events, ...done];
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

/** Narrative beats stretch/shrink with load — see PACE.crowd. */
const SPEED_UP = PACE.crowdScale;

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
  /** Scenes play strictly in order — one story at a time. */
  private scenes = new SceneQueue();
  /** Parent run id → agents it delegated to, in order. */
  private delegates = new Map<string, TownSlug[]>();
  /** Parent run ids whose delegations became a meeting at the table. */
  private meetings = new Set<string>();
  /** Child run id → who delegated it. */
  private parentOf = new Map<string, TownSlug>();
  /** Child run id → world time its hand-off was completed (work starts). */
  private workSince = new Map<string, number>();
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

  /** Too many scenes waiting → skip the walk, keep the bubble. */
  private get crowded() {
    return this.scenes.depth >= PACE.crowd;
  }
  /** A beat, shortened while the queue is long so the town can catch up. */
  private beat(ms: number) {
    return this.crowded ? Math.round(ms * SPEED_UP) : ms;
  }
  /** Queue a scene: it starts when the previous one is over and all its actors are free. */
  private scene(slugs: readonly TownSlug[], fn: () => Promise<void>) {
    void this.scenes.push(() => this.world.scene(slugs, fn));
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
        if (this.crowded || slug !== "jarvis") {
          w.say(slug, label, 2400, "pin");
          return;
        }
        // J.A.R.V.I.S. waits until you have finished handing the task over
        this.scene(["jarvis", "user"], async () => {
          await w.walkTo(slug, VISIT.jarvis);
          w.face(slug, "up");
          w.say(slug, "Biorę: " + label, this.beat(PACE.say), "pin");
          await w.wait(this.beat(PACE.beat));
          await w.goHome(slug);
        });
        return;
      }
      case "delegated": {
        const parent = e.parent ? this.slugOf(e.parent) : null;
        h.log(slug, `${parent ? h.name(parent) : "Ktoś"} → ${h.name(slug)}: „${e.task}”`);
        if (parent) this.parentOf.set(e.run.id, parent);
        if (parent === "jarvis" && e.parent && this.joinMeeting(e.parent.id, slug, e.task)) return;
        if (!parent || parent === slug || this.crowded) {
          w.say(slug, e.task, 2400, "mail");
          this.workSince.set(e.run.id, w.time);
          return;
        }
        // call them back to their desk now, so they're in when we arrive
        w.recall(slug);
        this.scene([parent, slug], async () => {
          await w.walkTo(parent, VISIT[slug]);
          await w.untilHome(slug, 6000);
          w.faceEachOther(parent, slug);
          w.say(parent, e.task, this.beat(PACE.say), "mail");
          await w.wait(this.beat(PACE.beat + 300));
          w.say(slug, accepted(slug), this.beat(1400), "check", "ok");
          await w.wait(this.beat(PACE.tick));
          this.workSince.set(e.run.id, w.time);
          await w.goHome(parent);
        });
        return;
      }
      case "tool": {
        h.log(slug, `${h.name(slug)} · ${e.tool}`);
        if (this.crowded) return; // shed: the log still has it
        this.scene([slug], async () => {
          w.say(slug, e.tool, this.beat(2600), iconForTool(e.tool), "tool");
          await w.wait(this.beat(PACE.tool));
        });
        return;
      }
      case "finished": {
        const runId = e.run.id;
        const msg = e.ok ? "Gotowe" : "Błąd";
        const tone = e.ok ? "ok" : "bad";
        const icon = e.ok ? "check" : "cross";
        h.log(slug, `${h.name(slug)} ${e.ok ? "skończył" : "zgłasza błąd"}`);
        // the meeting breaks up when the delegating run is over — after the
        // scenes before it have played, not before
        if (this.meetings.has(runId)) this.scene([], async () => this.endMeeting(runId));

        if (!e.run.parentRunId && slug === "jarvis") {
          h.commandFinished(runId, e.ok);
          if (this.crowded) {
            const text = this.answerText(e.ok);
            h.resultReady(runId, e.ok, text);
            w.say("jarvis", text, 2800, icon, tone);
            return;
          }
          if (w.walkMode) {
            // you're out walking — he pins the answer on the board for you
            this.scene(["jarvis"], async () => {
              await w.walkTo("jarvis", VISIT.jarvis);
              w.face("jarvis", "up");
              w.say("jarvis", "Wynik czeka na tablicy!", this.beat(PACE.say), "pin", tone);
              h.resultReady(runId, e.ok, this.answerText(e.ok));
              await w.wait(this.beat(PACE.beat));
              await w.goHome("jarvis");
            });
            return;
          }
          this.scene(["jarvis", "user"], async () => {
            // read at scene time: the reply may not have landed in the chat yet
            const text = this.answerText(e.ok);
            await w.walkTo("jarvis", VISIT.user);
            w.face("jarvis", "left");
            w.say("jarvis", text, this.beat(PACE.say + 400), icon, tone);
            await w.wait(this.beat(PACE.beat + 600));
            w.say("user", "Dzięki!", this.beat(1300));
            // only now is the note on the board — and Marvel goes to fetch it
            h.resultReady(runId, e.ok, text);
            await w.wait(this.beat(PACE.tick));
            await w.goHome("jarvis");
          });
          return;
        }

        const boss = this.parentOf.get(runId) ?? null;
        const inMeeting = !!e.run.parentRunId && this.meetings.has(e.run.parentRunId);
        if (inMeeting || this.crowded) {
          // seated at the table: report from the chair
          this.scene([slug], async () => {
            w.say(slug, msg, this.beat(2200), icon, tone);
            await w.wait(this.beat(PACE.beat));
          });
          return;
        }
        if (boss === "jarvis") {
          // the result goes back to whoever asked for it
          this.scene([slug, "jarvis"], async () => {
            const hold = workHold(this.workSince.get(runId), w.time, PACE.workMin);
            if (hold > 0) await w.wait(hold);
            this.workSince.delete(runId);
            this.parentOf.delete(runId);
            await Promise.all([w.walkTo(slug, BOARD_SPOTS[0]), w.walkTo("jarvis", VISIT.jarvis)]);
            w.faceEachOther(slug, "jarvis");
            w.say(slug, msg, this.beat(PACE.say - 400), icon, tone);
            await w.wait(this.beat(PACE.beat));
            w.say("jarvis", "Przyjąłem.", this.beat(1400));
            await w.wait(this.beat(PACE.tick));
            await Promise.all([w.goHome(slug), w.goHome("jarvis")]);
          });
          return;
        }
        // an agent working on its own: the result goes to the board
        const spot = BOARD_SPOTS[this.boardSlot++ % BOARD_SPOTS.length];
        this.scene([slug], async () => {
          await w.walkTo(slug, spot);
          w.face(slug, "up");
          w.say(slug, msg, this.beat(2200), icon, tone);
          await w.wait(this.beat(PACE.beat));
          await w.goHome(slug);
        });
        return;
      }
    }
  }

  /** What J.A.R.V.I.S. tells you when a request is over. */
  private answerText(ok: boolean) {
    const reply = this.hooks.latestReply();
    return !ok ? "Coś poszło nie tak, szczegóły w czacie" : (reply ?? "Gotowe, odpowiedź w czacie");
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
    const members = [...list];
    const seatOf = (s: TownSlug) => MEETING_SEATS[members.indexOf(s) % MEETING_SEATS.length];
    const first = !this.meetings.has(parentRunId);
    this.meetings.add(parentRunId);
    if (first) {
      this.hooks.log(
        "jarvis",
        `Narada w Rdzeniu: ${members.map((s) => this.hooks.name(s)).join(", ")}`,
      );
    }
    for (const s of members) w.recall(s);
    this.scene(["jarvis", ...members], async () => {
      if (first) {
        w.seat("jarvis", MEETING_HEAD, "right");
        for (const s of members) w.seat(s, seatOf(s), "up");
        await Promise.all(["jarvis" as TownSlug, ...members].map((s) => w.goHome(s)));
        w.face("jarvis", "right");
        w.say("jarvis", "Narada! Zbierzcie się przy stole.", this.beat(PACE.say), "mail");
        await w.wait(this.beat(PACE.beat));
      } else {
        w.seat(slug, seatOf(slug), "up");
        await Promise.all([w.goHome("jarvis"), w.goHome(slug)]);
      }
      await w.untilHome(slug, 8000);
      w.faceEachOther("jarvis", slug);
      w.say("jarvis", task, this.beat(PACE.say), "mail");
      await w.wait(this.beat(PACE.beat + 300));
      w.say(slug, accepted(slug), this.beat(1400), "check", "ok");
      await w.wait(this.beat(PACE.tick));
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
