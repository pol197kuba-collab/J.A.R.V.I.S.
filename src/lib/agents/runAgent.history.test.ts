import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./runtime.testkit";

// Etap 3 (A10): runAgent bierze historię z bazy po conversationId, przyciętą
// do budżetu tokenów; pole `history` od klienta tylko dla rozmowy bez wątku.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const runOrchestrator = vi.fn().mockResolvedValue({ runId: "r", status: "done", output: "ok" });
vi.mock("./runtime.server", () => ({ runOrchestrator }));

type Handler = (a: { data: unknown; context: unknown }) => Promise<unknown>;

const CONV = "11111111-1111-4111-8111-111111111111";

beforeEach(() => runOrchestrator.mockClear());

describe("runAgent — historia z serwera", () => {
  it("z conversationId: historia z messages (od najstarszej), historia klienta ignorowana", async () => {
    const { runAgent } = await import("./runtime.functions");
    const { db, calls } = makeDb((table) =>
      table === "messages"
        ? {
            // baza zwraca od najnowszej (order desc)
            data: [
              { role: "jarvis", content: "Dzień dobry." },
              { role: "user", content: "Cześć" },
            ],
            error: null,
          }
        : undefined,
    );

    await (runAgent as unknown as Handler)({
      data: {
        agentSlug: "jarvis",
        input: "Co u ciebie?",
        conversationId: CONV,
        history: [{ role: "user", text: "Z KLIENTA" }],
      },
      context: { supabase: db, userId: "u1" },
    });

    const args = runOrchestrator.mock.calls[0][0];
    expect(args.history).toEqual([
      { role: "user", text: "Cześć" },
      { role: "jarvis", text: "Dzień dobry." },
    ]);
    const q = calls.find((c) => c.table === "messages")!;
    expect(q.ops).toContainEqual({ method: "eq", args: ["conversation_id", CONV] });
    expect(q.ops).toContainEqual({ method: "eq", args: ["user_id", "u1"] });
  });

  it("bez conversationId: historia klienta, przycięta do budżetu", async () => {
    const { runAgent } = await import("./runtime.functions");
    const { db } = makeDb(() => undefined);
    const long = "y".repeat(7_999);
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? "jarvis" : "user") as "user" | "jarvis",
      text: long,
    }));

    await (runAgent as unknown as Handler)({
      data: { agentSlug: "jarvis", input: "Hej", history },
      context: { supabase: db, userId: "u1" },
    });

    const args = runOrchestrator.mock.calls[0][0];
    // 30 × ~2000 tokenów ≫ budżet 6000 → zostają tylko najnowsze, w całości.
    expect(args.history.length).toBeLessThan(30);
    expect(args.history.length).toBeGreaterThan(0);
    for (const t of args.history) expect(t.text).toBe(long);
  });
});
