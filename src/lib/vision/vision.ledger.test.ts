import { describe, it, expect, vi, afterEach } from "vitest";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Etap 2: Vision woła Gemini przez klienta modeli (klucz w nagłówku) i zostawia
// wiersz w księdze llm_usage. createServerFn zamockowany tak, żeby eksport był
// samym handlerem — testujemy logikę, nie framework.
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

function world() {
  return makeDb((table) =>
    table === "user_secrets" ? { data: { gemini_api_key: "tajny" }, error: null } : undefined,
  );
}

const geminiOk = (text: string) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 50 },
    }),
    text: async () => "",
  });

const ledgerRow = (calls: ReturnType<typeof makeDb>["calls"]) =>
  calls.find((c) => c.table === "llm_usage")?.ops[0].args[0] as Record<string, unknown>;

describe("Vision — klient modeli i księga", () => {
  it("podgląd na żywo: klucz w nagłówku, wiersz vision/live_detect", async () => {
    const fetchMock = geminiOk("[]");
    vi.stubGlobal("fetch", fetchMock);
    const { detectObjects } = await import("./live.functions");
    const { db, calls } = world();

    await (detectObjects as unknown as Handler)({
      data: { imageBase64: "x".repeat(200), mimeType: "image/jpeg" },
      context: { supabase: db, userId: "u1" },
    });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tajny");
    expect(ledgerRow(calls)).toMatchObject({
      owner_id: "u1",
      module: "vision",
      purpose: "live_detect",
      tokens_input: 800,
    });
  });

  it("analiza obrazu: wiersz vision/scan_analyze", async () => {
    vi.stubGlobal("fetch", geminiOk("Na zdjęciu kubek."));
    const { analyzeScan } = await import("./vision.functions");
    const { db, calls } = world();

    await (analyzeScan as unknown as Handler)({
      data: { imageBase64: "x".repeat(200), mimeType: "image/jpeg" },
      context: { supabase: db, userId: "u1" },
    });

    expect(ledgerRow(calls)).toMatchObject({ module: "vision", purpose: "scan_analyze" });
  });
});
