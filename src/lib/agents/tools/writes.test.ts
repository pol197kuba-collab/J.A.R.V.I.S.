import { describe, it, expect, vi, afterEach } from "vitest";
import { getToolByName, type ToolContext } from "../tools.server";
import { makeDb, type DbCall } from "../runtime.testkit";
import { listSubjects } from "@/lib/orders/subjects";
import { ORDER_CONDITIONS } from "@/lib/orders/rules";

// Testy narzędzi zapisujących (plan naprawczy, etap 4): co trafia do bazy
// i z jakim zawężeniem do właściciela. Klient bazy zamockowany — patrzymy na
// łańcuch wywołań, nie na prawdziwe wiersze.

afterEach(() => vi.unstubAllGlobals());

const ctx = (db: ToolContext["supabase"], logEvent = vi.fn()): ToolContext => ({
  supabase: db,
  userId: "owner-1",
  agentId: "agent-1",
  runId: "run-1",
  apiKey: "",
  model: "gemini-2.5-flash",
  logEvent,
});

const op = (calls: DbCall[], table: string, method: string) => {
  const call = calls.find((c) => c.table === table && c.ops.some((o) => o.method === method));
  return call ? { call, args: call.ops.find((o) => o.method === method)!.args } : undefined;
};
const eqs = (call: DbCall) =>
  call.ops.filter((o) => o.method === "eq").map((o) => [o.args[0], o.args[1]]);

const run = (name: string, args: Record<string, unknown>, c: ToolContext) =>
  getToolByName(name)!.execute(args, c);

describe("save_note", () => {
  it("zapisuje notatkę właściciela; bez klucza Gemini bez embeddingu", async () => {
    const { db, calls } = makeDb((t, ops) =>
      t === "notes" && ops.some((o) => o.method === "insert")
        ? { data: { id: "n1" }, error: null }
        : undefined,
    );
    const res = await run(
      "save_note",
      { title: " Zakupy ", body: "mleko", tags: ["dom"] },
      ctx(db),
    );
    expect(res).toEqual({ ok: true, id: "n1", title: "Zakupy" });
    expect(op(calls, "notes", "insert")!.args[0]).toEqual({
      owner_id: "owner-1",
      title: "Zakupy",
      body: "mleko",
      tags: ["dom"],
      source: "jarvis",
    });
  });

  it("bez tytułu nic nie zapisuje", async () => {
    const { db, calls } = makeDb(() => undefined);
    expect(await run("save_note", { body: "x" }, ctx(db))).toEqual({ error: "missing_title" });
    expect(calls).toHaveLength(0);
  });
});

describe("delete_note", () => {
  it("usuwa tylko notatkę właściciela", async () => {
    const { db, calls } = makeDb((t) =>
      t === "notes" ? { data: { id: "n1", title: "Zakupy" }, error: null } : undefined,
    );
    expect(await run("delete_note", { id: "n1" }, ctx(db))).toEqual({ ok: true, id: "n1" });
    const del = op(calls, "notes", "delete")!;
    expect(eqs(del.call)).toEqual([
      ["id", "n1"],
      ["owner_id", "owner-1"],
    ]);
  });

  it("cudza albo nieistniejąca notatka: note_not_found", async () => {
    const { db } = makeDb((t) => (t === "notes" ? { data: null, error: null } : undefined));
    expect(await run("delete_note", { id: "obca" }, ctx(db))).toEqual({ error: "note_not_found" });
  });
});

describe("create_task", () => {
  it("zapisuje zadanie z agentem-autorem, przyciętym priorytetem i odrzuconą złą datą", async () => {
    const { db, calls } = makeDb((t, ops) =>
      t === "tasks" && ops.some((o) => o.method === "insert")
        ? { data: { id: "t1", title: "Raport", status: "todo", priority: 5 }, error: null }
        : undefined,
    );
    const res = await run(
      "create_task",
      { title: "Raport", priority: 9, due_at: "nie-data", assignee_slug: "herald" },
      ctx(db),
    );
    expect(res).toMatchObject({ ok: true, id: "t1" });
    expect(op(calls, "tasks", "insert")!.args[0]).toMatchObject({
      user_id: "owner-1",
      created_by_agent: "agent-1",
      title: "Raport",
      assignee_slug: "herald",
      priority: 5,
      due_at: null,
      project_id: null,
    });
  });
});

describe("update_task", () => {
  it("status done stempluje completed_at, zapis zawężony do właściciela", async () => {
    const { db, calls } = makeDb((t) =>
      t === "tasks"
        ? { data: { id: "t1", title: "Raport", status: "done", priority: 3 }, error: null }
        : undefined,
    );
    const res = await run("update_task", { id: "t1", status: "done", result: "Gotowe." }, ctx(db));
    expect(res).toMatchObject({ ok: true, status: "done" });
    const upd = op(calls, "tasks", "update")!;
    expect(upd.args[0]).toMatchObject({ status: "done", result: "Gotowe." });
    expect(typeof (upd.args[0] as { completed_at: unknown }).completed_at).toBe("string");
    expect(eqs(upd.call)).toEqual([
      ["id", "t1"],
      ["user_id", "owner-1"],
    ]);
  });

  it("nieznany status i pusta zmiana nic nie zapisują", async () => {
    const { db, calls } = makeDb(() => undefined);
    expect(await run("update_task", { id: "t1", status: "zrobione" }, ctx(db))).toMatchObject({
      error: "invalid_status",
    });
    expect(await run("update_task", { id: "t1" }, ctx(db))).toEqual({
      error: "nothing_to_update",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("remember", () => {
  it("klucz istniejącego faktu nadpisuje wpis zamiast dublować", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { db, calls } = makeDb((t, ops) =>
      t === "memories" &&
      ops.some((o) => o.method === "select") &&
      !ops.some((o) => o.method === "update")
        ? { data: { id: "m1" }, error: null }
        : undefined,
    );
    const res = await run("remember", { value: "Mam na imię Kuba.", key: "user_name" }, ctx(db));
    expect(res).toEqual({ ok: true, id: "m1", key: "user_name", updated: true });
    expect(op(calls, "memories", "insert")).toBeUndefined();
    const upd = op(calls, "memories", "update")!;
    expect(upd.args[0]).toMatchObject({ value: "Mam na imię Kuba.", origin: "user" });
    expect(eqs(upd.call)).toEqual([["id", "m1"]]);
  });
});

describe("zlecenia stałe", () => {
  it("create_standing_order: znany przedmiot → upsert rozkazu właściciela", async () => {
    const subject = listSubjects().find((s) => s.kind === "market")!;
    const { db, calls } = makeDb((t) =>
      t === "standing_orders"
        ? {
            data: {
              id: "o1",
              subject_kind: "market",
              subject: subject.id,
              condition: ORDER_CONDITIONS[0],
              threshold: 5,
              window_days: 1,
              cooldown_hours: 24,
              phrase: null,
              expires_at: null,
              is_enabled: true,
              last_triggered_at: null,
              trigger_count: 0,
              created_at: "2026-11-12T00:00:00Z",
            },
            error: null,
          }
        : undefined,
    );
    const res = await run(
      "create_standing_order",
      { subject_kind: "market", subject: subject.id, condition: ORDER_CONDITIONS[0], threshold: 5 },
      ctx(db),
    );
    expect(res).toMatchObject({ ok: true, order_id: "o1" });
    expect(op(calls, "standing_orders", "upsert")!.args[0]).toMatchObject({
      owner_id: "owner-1",
      subject_kind: "market",
      subject: subject.id,
      threshold: 5,
      is_enabled: true,
    });
  });

  it("create_standing_order: nieznany przedmiot → rejected z listą dostępnych, bez zapisu", async () => {
    const { db, calls } = makeDb(() => undefined);
    const res = (await run(
      "create_standing_order",
      {
        subject_kind: "market",
        subject: "XYZ-nie-istnieje",
        condition: ORDER_CONDITIONS[0],
        threshold: 5,
      },
      ctx(db),
    )) as { error: string; available: string[] };
    expect(res.error).toBe("rejected");
    expect(res.available.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it("create_standing_order: zły próg odrzucony", async () => {
    const { db } = makeDb(() => undefined);
    expect(
      await run(
        "create_standing_order",
        { subject: "x", condition: "above", threshold: -1 },
        ctx(db),
      ),
    ).toMatchObject({ error: "bad_threshold" });
  });

  it("cancel_standing_order: usunięcie albo wyłączenie, zawsze zawężone do właściciela", async () => {
    const { db, calls } = makeDb(() => undefined);
    expect(await run("cancel_standing_order", { order_id: "o1" }, ctx(db))).toEqual({
      ok: true,
      mode: "deleted",
    });
    expect(eqs(op(calls, "standing_orders", "delete")!.call)).toEqual([
      ["id", "o1"],
      ["owner_id", "owner-1"],
    ]);
    expect(
      await run("cancel_standing_order", { order_id: "o1", mode: "disable" }, ctx(db)),
    ).toEqual({
      ok: true,
      mode: "disabled",
    });
    expect(op(calls, "standing_orders", "update")!.args[0]).toEqual({ is_enabled: false });
  });
});
