import { describe, it, expect, vi, afterEach } from "vitest";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Etap 2: embedding notatki zostawia wiersz w księdze llm_usage.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Handler = (a: { data: unknown; context: unknown }) => Promise<unknown>;

afterEach(() => vi.unstubAllGlobals());

describe("createNote — embedding w księdze", () => {
  it("wiersz notes/embed z modelem embeddingu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: new Array(768).fill(0.01) } }),
        text: async () => "",
      }),
    );
    const { createNote } = await import("./notes.functions");
    const { db, calls } = makeDb((table, ops) => {
      if (table === "user_secrets") return { data: { gemini_api_key: "k" }, error: null };
      if (table === "notes" && ops.some((o) => o.method === "insert"))
        return {
          data: { id: "n1", title: "T", body: "B", tags: [], created_at: "", updated_at: "" },
          error: null,
        };
      return undefined;
    });

    await (createNote as unknown as Handler)({
      data: { title: "Zakupy", body: "mleko, chleb", tags: [] },
      context: { supabase: db, userId: "u1" },
    });

    const row = calls.find((c) => c.table === "llm_usage")?.ops[0].args[0];
    expect(row).toMatchObject({
      owner_id: "u1",
      module: "notes",
      purpose: "embed",
      model: "gemini-embedding-001",
    });
  });
});
