import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb, has, eqValue, firstArg } from "./runtime.testkit";

// Plan naprawczy, etap 6: zadanie dokumentowe może podnieść przeglądarka
// (od razu po turze czatu) ORAZ kolejka w tle (workflow z pg_cron). Przejęcie
// musi być jednym warunkowym UPDATE-em — inaczej dwa przebiegi naraz
// zbudowałyby ten sam plik dwa razy i dwa razy zapłaciły za model.
const agentLoop = vi.fn(async () => ({
  runId: "r",
  status: "error" as const,
  output: "",
  error: "test: koniec po przejęciu",
}));
vi.mock("./runtime.server", () => ({ runAgentLoop: agentLoop }));
vi.mock("@/lib/notifications/notify.server", () => ({ notifyOwner: vi.fn(async () => {}) }));

const JOB = {
  id: "11111111-1111-1111-1111-111111111111",
  run_id: null,
  title: "Prezentacja",
  brief: "Zrób prezentację",
  status: "queued",
  attempts: 0,
};

beforeEach(() => agentLoop.mockClear());

function world(claimWins: boolean) {
  return makeDb((table, ops) => {
    if (table === "document_jobs" && has(ops, "update")) {
      const patch = firstArg(ops, "update");
      // Warunkowe przejęcie: zwraca wiersz tylko temu, kto wygrał.
      if (patch?.status === "running" && has(ops, "select")) {
        return { data: claimWins ? { id: JOB.id } : null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "document_jobs") return { data: JOB, error: null };
    return undefined;
  });
}

describe("przejęcie zadania dokumentowego", () => {
  it("przegrany wyścig: drugi przebieg nie rusza potoku", async () => {
    const { db } = world(false);
    const { runDocumentJobCore } = await import("./documentJobs.functions");
    const result = await runDocumentJobCore(db, "u1", JOB.id);
    expect(result).toEqual({ ok: false, reason: "not_queued" });
    expect(agentLoop).not.toHaveBeenCalled();
  });

  it("przejęcie to jeden UPDATE z warunkiem na status i licznik podejść", async () => {
    const { db, calls } = world(true);
    const { runDocumentJobCore } = await import("./documentJobs.functions");
    await runDocumentJobCore(db, "u1", JOB.id);
    const claim = calls.find(
      (c) => c.table === "document_jobs" && firstArg(c.ops, "update")?.status === "running",
    );
    expect(claim).toBeDefined();
    expect(firstArg(claim!.ops, "update")).toMatchObject({ status: "running", attempts: 1 });
    expect(eqValue(claim!.ops, "status")).toBe("queued");
    expect(eqValue(claim!.ops, "attempts")).toBe(0);
    expect(agentLoop).toHaveBeenCalled();
  });
});
