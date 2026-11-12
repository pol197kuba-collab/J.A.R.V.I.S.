import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb } from "./runtime.testkit";
import type { OrchestratorInput } from "./runtime/types";

// Zgłoszenie właściciela (2026-11-12): wiadomość wysłana, zanim czat wczytał
// swój wątek (conversationId jeszcze null), zakładała NOWY wątek. Czat
// pokazywał potem tylko ten nowy wątek z dwiema wiadomościami — starej
// rozmowy nie dało się przewinąć, a model widział historię z przeglądarki.
// Bez conversationId runAgent dopisuje do ostatniego wątku agenta.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const orchestrator = vi.fn(async (_args: OrchestratorInput) => ({
  runId: "r1",
  status: "done" as const,
  output: "ok",
}));
vi.mock("./runtime.server", () => ({ runOrchestrator: orchestrator }));

type Handler = (a: { data: unknown; context: unknown }) => Promise<unknown>;

const OLD_THREAD = [
  { role: "jarvis", content: "Odpowiedź sprzed tygodnia" },
  { role: "user", content: "Pytanie sprzed tygodnia" },
];

beforeEach(() => orchestrator.mockClear());

async function callRunAgent(data: Record<string, unknown>, conversations: unknown[]) {
  const { db } = makeDb((table) => {
    if (table === "agents") return { data: { id: "agent-1" }, error: null };
    if (table === "conversations") return { data: conversations[0] ?? null, error: null };
    if (table === "messages") return { data: OLD_THREAD, error: null };
    return undefined;
  });
  const { runAgent } = await import("./runtime.functions");
  await (runAgent as unknown as Handler)({ data, context: { supabase: db, userId: "u1" } });
  return orchestrator.mock.calls[0][0];
}

describe("runAgent bez conversationId", () => {
  it("dopisuje do ostatniego wątku agenta i bierze historię z bazy", async () => {
    const args = await callRunAgent(
      {
        agentSlug: "jarvis",
        input: "Otwórz jarvisa",
        history: [{ role: "user", text: "historia z przeglądarki" }],
      },
      [{ id: "conv-old" }],
    );
    expect(args.conversationId).toBe("conv-old");
    expect(args.history).toEqual([
      { role: "user", text: "Pytanie sprzed tygodnia" },
      { role: "jarvis", text: "Odpowiedź sprzed tygodnia" },
    ]);
  });

  it("bez żadnego wątku — nowy wątek (null) i historia od klienta", async () => {
    const args = await callRunAgent(
      { agentSlug: "jarvis", input: "Cześć", history: [{ role: "jarvis", text: "Witaj" }] },
      [],
    );
    expect(args.conversationId).toBeNull();
    expect(args.history).toEqual([{ role: "jarvis", text: "Witaj" }]);
  });
});
