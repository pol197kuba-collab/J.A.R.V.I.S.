import { describe, it, expect, vi, afterEach } from "vitest";
import { runOrchestrator } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  json,
  geminiText,
  providerFetch,
  worldDb,
  writes,
  type Op,
} from "./runtime.testkit";

// A19 (plan naprawczy, etap 4): koniec runu ustawiał agentowi „idle” (albo
// „error”), nawet gdy ten sam agent miał jeszcze inny run w toku — widżet
// statusu i Town pokazywały wolnego agenta, który właśnie pracował.

afterEach(() => vi.unstubAllGlobals());

const isRunningCheck = (ops: Op[]) =>
  ops.some((o) => o.method === "select") &&
  ops.some((o) => o.method === "eq" && o.args[0] === "status" && o.args[1] === "running");

function world(otherRunning: boolean) {
  return worldDb({
    agents: [HERALD],
    secrets: KEYS_GEMINI_ONLY,
    extra: (table, ops) =>
      table === "agent_runs" && isRunningCheck(ops)
        ? { data: otherRunning ? [{ id: "run-other" }] : [], error: null }
        : undefined,
  });
}

const run = (db: ReturnType<typeof world>["db"]) =>
  runOrchestrator({
    supabase: db,
    userId: "u1",
    agentSlug: AGENT_SLUGS.HERALD,
    input: "Hej",
    history: [],
    delegationDepth: 1,
    parentRunId: "run-parent",
  });

const finalAgentStatus = (calls: ReturnType<typeof world>["calls"]) =>
  writes(calls, "agents", "update")
    .map((w) => w.payload.status)
    .filter(Boolean);

describe("A19 — status agenta przy równoległych runach", () => {
  it("brak innego runu w toku: koniec ustawia idle (jak dotąd)", async () => {
    vi.stubGlobal("fetch", providerFetch({ gemini: [geminiText("ok")] }));
    const { db, calls } = world(false);
    await run(db);
    expect(finalAgentStatus(calls)).toEqual(["busy", "idle"]);
  });

  it("inny run tego agenta w toku: status zostaje busy", async () => {
    vi.stubGlobal("fetch", providerFetch({ gemini: [geminiText("ok")] }));
    const { db, calls } = world(true);
    await run(db);
    expect(finalAgentStatus(calls)).toEqual(["busy"]);
    // Sprawdzenie dotyczy tego agenta, innych runów niż bieżący i tylko świeżych.
    const check = calls.find((c) => c.table === "agent_runs" && isRunningCheck(c.ops))!;
    const ops = check.ops.map((o) => [o.method, o.args[0]]);
    expect(ops).toContainEqual(["eq", "agent_id"]);
    expect(ops).toContainEqual(["neq", "id"]);
    expect(ops).toContainEqual(["gte", "started_at"]);
  });

  it("błąd runu przy innym runie w toku: nie nadpisuje statusu na error", async () => {
    vi.stubGlobal("fetch", providerFetch({ gemini: [json(400, "zły klucz")] }));
    const { db, calls } = world(true);
    const result = await run(db);
    expect(result.status).toBe("error");
    expect(finalAgentStatus(calls)).toEqual(["busy"]);
  });
});
