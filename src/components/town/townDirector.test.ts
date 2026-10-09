import { describe, expect, it } from "vitest";
import type { FlowRun } from "@/lib/agents/flow.functions";
import { characterStatus, diffFlow, isMeeting, snapshotRuns } from "./townDirector";

const run = (p: Partial<FlowRun> & Pick<FlowRun, "id" | "agentSlug">): FlowRun => ({
  agentName: p.agentSlug,
  parentRunId: null,
  status: "running",
  toolCalls: [],
  delegations: [],
  latencyMs: null,
  createdAt: "2026-10-09T08:00:00.000Z",
  finishedAt: null,
  ...p,
});

describe("diffFlow", () => {
  it("treats the first poll as a baseline, not as news", () => {
    expect(diffFlow(null, [run({ id: "a", agentSlug: "jarvis" })])).toEqual([]);
  });

  it("turns a new child run into a delegation carrying the parent's task text", () => {
    const parent = run({
      id: "p",
      agentSlug: "jarvis",
      delegations: [{ toSlug: "insight", task: "Zbierz prognozy cen paliw" }],
    });
    const prev = snapshotRuns([parent]);
    const child = run({
      id: "c",
      agentSlug: "insight",
      parentRunId: "p",
      createdAt: "2026-10-09T08:00:05.000Z",
    });
    const ev = diffFlow(prev, [parent, child]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "delegated", task: "Zbierz prognozy cen paliw" });
  });

  it("reports only the newest tool call and the finish of a known run", () => {
    const before = run({
      id: "r",
      agentSlug: "metric",
      toolCalls: [{ name: "search_documents", args: {} }],
    });
    const prev = snapshotRuns([before]);
    const after = run({
      ...before,
      status: "done",
      finishedAt: "2026-10-09T08:00:09.000Z",
      toolCalls: [...before.toolCalls, { name: "market_outlook", args: {} }],
    });
    const ev = diffFlow(prev, [after]);
    expect(ev.map((e) => e.type)).toEqual(["tool", "finished"]);
    expect(ev[0]).toMatchObject({ tool: "market_outlook" });
    expect(ev[1]).toMatchObject({ ok: true });
  });

  it("plays a run that started and failed between two polls in order", () => {
    const prev = snapshotRuns([]);
    const r = run({
      id: "x",
      agentSlug: "shield",
      status: "error",
      finishedAt: "2026-10-09T08:00:02.000Z",
    });
    expect(diffFlow(prev, [r]).map((e) => e.type)).toEqual(["started", "finished"]);
    expect(diffFlow(prev, [r])[1]).toMatchObject({ ok: false });
  });

  it("orders events by run creation time", () => {
    const prev = snapshotRuns([]);
    const late = run({ id: "late", agentSlug: "forge", createdAt: "2026-10-09T08:00:09.000Z" });
    const early = run({ id: "early", agentSlug: "herald", createdAt: "2026-10-09T08:00:01.000Z" });
    expect(diffFlow(prev, [late, early]).map((e) => e.run.id)).toEqual(["early", "late"]);
  });
});

describe("characterStatus", () => {
  const now = Date.parse("2026-10-09T08:01:00.000Z");
  it("is off for a disabled agent and running while any run is active", () => {
    expect(characterStatus("forge", [], false, now)).toBe("off");
    expect(characterStatus("forge", [run({ id: "1", agentSlug: "forge" })], true, now)).toBe(
      "running",
    );
  });
  it("shows a recent error for a while, then goes back to idle", () => {
    const failed = run({
      id: "1",
      agentSlug: "shield",
      status: "error",
      finishedAt: "2026-10-09T08:00:30.000Z",
    });
    expect(characterStatus("shield", [failed], true, now)).toBe("error");
    expect(characterStatus("shield", [failed], true, now + 120_000)).toBe("idle");
  });
  it("flashes done right after finishing", () => {
    const ok = run({
      id: "1",
      agentSlug: "metric",
      status: "done",
      finishedAt: "2026-10-09T08:00:57.000Z",
    });
    expect(characterStatus("metric", [ok], true, now)).toBe("done");
  });
});

describe("isMeeting", () => {
  it("hands the first delegation over in person and gathers from the second", () => {
    expect(isMeeting(1)).toBe(false);
    expect(isMeeting(2)).toBe(true);
    expect(isMeeting(4)).toBe(true);
  });
});
