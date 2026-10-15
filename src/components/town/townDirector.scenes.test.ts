import { describe, expect, it } from "vitest";
import type { FlowResult, FlowRun } from "@/lib/agents/flow.functions";
import { TownDirector, type DirectorHooks } from "./townDirector";
import type { TownSlug } from "./townMap";
import type { TownWorld } from "./townWorld";

const run = (p: Partial<FlowRun> & Pick<FlowRun, "id" | "agentSlug">): FlowRun => ({
  agentName: p.agentSlug,
  parentRunId: null,
  status: "done",
  toolCalls: [],
  delegations: [],
  latencyMs: null,
  createdAt: "2026-10-09T08:00:00.000Z",
  finishedAt: "2026-10-09T08:00:09.000Z",
  ...p,
});

/** A world that only records what it is told, with instant walks and a virtual clock. */
function fakeWorld() {
  const log: string[] = [];
  const busy = new Map<string, Promise<void>>();
  let now = 0;
  const w = {
    walkMode: false,
    get time() {
      return now;
    },
    backlog: () => 0,
    recall: () => {},
    seat: () => {},
    release: () => {},
    face: () => {},
    faceEachOther: () => {},
    untilHome: async () => {},
    async wait(ms: number) {
      now += ms;
      await Promise.resolve();
    },
    async walkTo(slug: TownSlug, tile: readonly number[]) {
      log.push(`walk ${slug}→${tile.join(",")}`);
      await Promise.resolve();
    },
    async goHome(slug: TownSlug) {
      log.push(`home ${slug}`);
      await Promise.resolve();
    },
    say(slug: TownSlug, text: string) {
      log.push(`say ${slug}: ${text}`);
    },
    // same contract as TownWorld.scene: wait for every actor, hold them all
    async scene(slugs: readonly TownSlug[], fn: () => Promise<void>) {
      const who = [...new Set(slugs)];
      await Promise.all(who.map((s) => busy.get(s) ?? Promise.resolve()));
      const done = fn();
      for (const s of who) busy.set(s, done);
      await done;
    },
  };
  return { world: w as unknown as TownWorld, log };
}

const hooks = (log: string[]): DirectorHooks => ({
  log: () => {},
  takeCommand: () => ({
    id: "c1",
    text: "co się popsuło?",
    target: "shield",
    createdAt: 0,
    runId: null,
    state: "pending",
  }),
  commandFinished: () => {},
  latestReply: () => "Nic krytycznego.",
  resultReady: () => log.push("RESULT READY (dog fetches)"),
  name: (s) => s,
});

describe("TownDirector scenes", () => {
  it("plays 'ask Shield' as one story even when the whole request ended within one poll", async () => {
    const { world, log } = fakeWorld();
    const d = new TownDirector(world, hooks(log));
    const parent = run({
      id: "p",
      agentSlug: "jarvis",
      finishedAt: "2026-10-09T08:00:08.000Z",
      delegations: [{ toSlug: "shield", task: "Sprawdź co się zepsuło" }],
    });
    d.ingest({ runs: [] } as unknown as FlowResult);
    const child = run({
      id: "c",
      agentSlug: "shield",
      parentRunId: "p",
      createdAt: "2026-10-09T08:00:02.000Z",
      finishedAt: "2026-10-09T08:00:05.000Z",
      toolCalls: [{ name: "get_errors", args: {} }],
    });
    d.ingest({ runs: [parent, child] } as unknown as FlowResult);
    await new Promise((r) => setTimeout(r, 20));

    const at = (needle: string) => log.findIndex((l) => l.includes(needle));
    const order = [
      "Biorę:", // J.A.R.V.I.S. takes the task from you
      "say jarvis: Sprawdź co się zepsuło", // hands it over in Shield's room
      "say shield: get_errors", // Shield works
      "say shield: Gotowe", // result goes back to J.A.R.V.I.S.
      "say jarvis: Przyjąłem.",
      "say jarvis: Nic krytycznego.", // J.A.R.V.I.S. tells you
      "RESULT READY", // only then the dog fetches the note
    ].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
