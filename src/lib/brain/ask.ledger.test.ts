import { describe, it, expect, vi, afterEach } from "vitest";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Etap 2: odpowiedź Mózgu przez klienta modeli, z wierszem w księdze.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Handler = (a: { data: unknown; context: unknown }) => Promise<{ status: string }>;

afterEach(() => vi.unstubAllGlobals());

describe("askBrain — klient modeli i księga", () => {
  it("odpowiedź: klucz w nagłówku, wiersz brain/ask", async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes(":embedContent")
        ? { ok: false, status: 500, json: async () => ({}), text: async () => "" }
        : {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: "Nie ma tego w zapisanej wiedzy." }] } }],
              usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 12 },
            }),
            text: async () => "",
          },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { askBrain } = await import("./ask.functions");
    const { db, calls } = makeDb((table) =>
      table === "user_secrets"
        ? { data: { gemini_api_key: "tajny" }, error: null }
        : { data: [], error: null },
    );

    const res = await (askBrain as unknown as Handler)({
      data: { question: "Co wiem o espresso?" },
      context: { supabase: db, userId: "u1" },
    });

    expect(res.status).toBe("ok");
    const answerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes(":generateContent"))!;
    expect(String(answerCall[0])).not.toContain("tajny");
    const rows = calls
      .filter((c) => c.table === "llm_usage")
      .map((c) => c.ops[0].args[0] as Record<string, unknown>);
    expect(rows).toContainEqual(
      expect.objectContaining({ module: "brain", purpose: "ask", tokens_input: 90 }),
    );
  });
});
