import { describe, it, expect, vi, afterEach } from "vitest";
import { geminiUsage, llmCost, addUsage, ZERO_USAGE } from "./usage";
import { recordLlmUsage, type LedgerContext } from "./ledger";
import { callGemini, embedWithGemini } from "./gemini";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Klient modeli i księga zużycia (plan naprawczy, etap 2).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const fail = (status: number, text = "") => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => text,
});

function ledgerFor() {
  const { db, calls } = makeDb(() => undefined);
  const ledger: LedgerContext = {
    db,
    ownerId: "u1",
    module: "agents",
    purpose: "turn",
    runId: "r1",
  };
  const rows = () =>
    calls
      .filter((c) => c.table === "llm_usage")
      .map((c) => c.ops.find((o) => o.method === "insert")!.args[0] as Record<string, unknown>);
  return { ledger, rows };
}

describe("zużycie i koszt", () => {
  it("geminiUsage czyta tokeny myślenia i cache (A11)", () => {
    expect(
      geminiUsage({
        promptTokenCount: 1000,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 300,
        cachedContentTokenCount: 400,
      }),
    ).toEqual({ input: 1000, output: 200, thinking: 300, cacheRead: 400, cacheWrite: 0 });
    expect(geminiUsage(undefined)).toEqual(ZERO_USAGE);
  });

  it("myślenie Gemini kosztuje jak wyjście, wejście po pełnej stawce mimo cache", () => {
    const usage = { input: 1000, output: 200, thinking: 300, cacheRead: 400, cacheWrite: 0 };
    // 1000 × 0,3/M + (200 + 300) × 2,5/M
    expect(llmCost("gemini", "gemini-2.5-flash", usage)).toBe(0.00155);
  });

  it("model spoza cennika daje null, nie zero", () => {
    expect(llmCost("gemini", "model-z-przyszlosci", { ...ZERO_USAGE, input: 10 })).toBeNull();
  });

  it("addUsage sumuje wszystkie pola", () => {
    const a = { input: 1, output: 2, thinking: 3, cacheRead: 4, cacheWrite: 5 };
    expect(addUsage(a, a)).toEqual({
      input: 2,
      output: 4,
      thinking: 6,
      cacheRead: 8,
      cacheWrite: 10,
    });
  });
});

describe("księga llm_usage", () => {
  it("zapisuje wiersz z modułem, celem, tokenami, kosztem i runem", async () => {
    const { ledger, rows } = ledgerFor();
    const cost = await recordLlmUsage(ledger, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      usage: { input: 1000, output: 200, thinking: 300, cacheRead: 0, cacheWrite: 0 },
    });
    expect(cost).toBe(0.00155);
    expect(rows()).toEqual([
      {
        owner_id: "u1",
        module: "agents",
        purpose: "turn",
        provider: "gemini",
        model: "gemini-2.5-flash",
        tokens_input: 1000,
        tokens_output: 200,
        tokens_thinking: 300,
        cache_read: 0,
        cache_write: 0,
        cost_usd: 0.00155,
        estimated: false,
        run_id: "r1",
      },
    ]);
  });

  it("awaria zapisu nie przerywa wywołującego", async () => {
    const { db } = makeDb(() => ({ data: null, error: { message: "permission denied" } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordLlmUsage(
        { db, ownerId: "u1", module: "m", purpose: "p" },
        { provider: "groq", model: "x", usage: ZERO_USAGE },
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("callGemini", () => {
  it("klucz w nagłówku x-goog-api-key, nie w adresie (A18), zużycie do księgi", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        candidates: [{ content: { parts: [{ text: "hej" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { ledger, rows } = ledgerFor();

    const res = await callGemini({
      apiKey: "tajny-klucz",
      model: "gemini-2.5-flash",
      body: { contents: [] },
      timeoutMs: 1000,
      ledger,
    });

    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("tajny-klucz");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("tajny-klucz");
    expect(rows()[0]).toMatchObject({ tokens_input: 10, tokens_output: 5, tokens_thinking: 7 });
  });

  it("ponawia raz po 503, nie ponawia po 400", async () => {
    vi.useFakeTimers();
    const flaky = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok({}));
    vi.stubGlobal("fetch", flaky);
    const p = callGemini({ apiKey: "k", model: "m", body: {}, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    expect((await p).ok).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockResolvedValue(fail(400, "API key not valid"));
    vi.stubGlobal("fetch", bad);
    const r = await callGemini({ apiKey: "k", model: "m", body: {}, timeoutMs: 1000 });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Gemini HTTP 400: API key not valid");
  });

  it("nieudane wywołanie nie zostawia wiersza w księdze", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail(400)));
    const { ledger, rows } = ledgerFor();
    await callGemini({ apiKey: "k", model: "m", body: {}, timeoutMs: 1000, ledger });
    expect(rows()).toEqual([]);
  });
});

describe("embedWithGemini", () => {
  it("bez zużycia od dostawcy zapisuje szacunek oznaczony estimated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ embedding: { values: [0.1, 0.2] } })));
    const { ledger, rows } = ledgerFor();
    const v = await embedWithGemini({
      apiKey: "k",
      model: "gemini-embedding-001",
      text: "a".repeat(40),
      taskType: "RETRIEVAL_QUERY",
      timeoutMs: 1000,
      ledger,
    });
    expect(v).toEqual([0.1, 0.2]);
    expect(rows()[0]).toMatchObject({
      tokens_input: 10,
      estimated: true,
      model: "gemini-embedding-001",
    });
  });
});
