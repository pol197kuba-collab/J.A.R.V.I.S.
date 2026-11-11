import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyNewsImpact } from "./news.server";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Etap 2: ocena newsów paliwowych przez klienta modeli, z księgą llm_usage.

afterEach(() => vi.unstubAllGlobals());

describe("classifyNewsImpact — klient modeli i księga", () => {
  it("klucz w nagłówku, wiersz z modułem fuel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '[{"impact":"up","score":0.6,"summary":"Ropa drożeje."}]' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = makeDb(() => undefined);

    const verdicts = await classifyNewsImpact(
      [{ guid: "g1", title: "Ropa w górę", feedTag: "pl" } as never],
      "tajny",
      { db, ownerId: "u1", module: "fuel", purpose: "news" },
    );

    expect(verdicts).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tajny");
    const row = calls.find((c) => c.table === "llm_usage")?.ops[0].args[0];
    expect(row).toMatchObject({ module: "fuel", purpose: "news", tokens_input: 120 });
  });
});
