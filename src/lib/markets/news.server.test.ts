// Testy granicy modelu: normalizeVerdict jest jedynym miejscem, gdzie
// odpowiedź LLM-a staje się danymi, którym ufa reszta modułu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { MARKET_ASSETS } from "./assets";
import { classifyMarketNews, normalizeVerdict } from "./news.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeVerdict", () => {
  it("accepts a well-formed verdict", () => {
    const v = normalizeVerdict(
      { symbols: ["BTC"], impact: "bullish", score: 72, summary_pl: "Popyt rośnie." },
      "Bitcoin rallies",
      MARKET_ASSETS,
    );
    expect(v).toEqual({
      symbols: ["BTC"],
      impact: "bullish",
      impactScore: 72,
      summaryPl: "Popyt rośnie.",
      classifiedBy: "ai",
    });
  });

  it("drops symbols the model invented", () => {
    // Filtrowanie i agregacja opierają się na tych symbolach — wpuszczenie
    // wymyślonego stworzyłoby instrument widmo, którego nie ma w katalogu.
    const v = normalizeVerdict(
      { symbols: ["BTC", "TSLA.US", "Bitcoin"], impact: "neutral", score: 30 },
      "t",
      MARKET_ASSETS,
    );
    expect(v.symbols).toEqual(["BTC"]);
  });

  it("uppercases and de-duplicates what the model returned", () => {
    const v = normalizeVerdict(
      { symbols: ["btc", "BTC", " eth "], impact: "bullish", score: 50 },
      "t",
      MARKET_ASSETS,
    );
    expect(v.symbols).toEqual(["BTC", "ETH"]);
  });

  it("clamps a score outside the range the schema promises", () => {
    expect(
      normalizeVerdict({ impact: "bullish", score: 999 }, "t", MARKET_ASSETS).impactScore,
    ).toBe(100);
    expect(normalizeVerdict({ impact: "bearish", score: -5 }, "t", MARKET_ASSETS).impactScore).toBe(
      0,
    );
  });

  it("falls back to the heuristic when impact is missing or bogus", () => {
    const v = normalizeVerdict(
      { impact: "very bullish", score: 80 },
      "Nvidia beats expectations",
      MARKET_ASSETS,
    );
    expect(v.classifiedBy).toBe("heuristic");
    expect(v.impact).toBe("bullish");
  });

  it("falls back for a non-object payload", () => {
    expect(normalizeVerdict("nope", "t", MARKET_ASSETS).classifiedBy).toBe("heuristic");
    expect(normalizeVerdict(null, "t", MARKET_ASSETS).classifiedBy).toBe("heuristic");
  });
});

describe("classifyMarketNews", () => {
  it("uses the heuristic when no key is configured", async () => {
    const out = await classifyMarketNews(["Bitcoin surges"], MARKET_ASSETS, {
      anthropicApiKey: null,
      geminiApiKey: null,
    });
    expect(out[0].classifiedBy).toBe("heuristic");
    expect(out[0].symbols).toContain("BTC");
  });

  it("prefers Claude when its key is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "text",
            text: '[{"symbols":["BTC"],"impact":"bullish","score":70,"summary_pl":"Wzrost."}]',
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await classifyMarketNews(["Bitcoin surges"], MARKET_ASSETS, {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem-test",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("api.anthropic.com");
    expect(out[0]).toMatchObject({ impact: "bullish", impactScore: 70, classifiedBy: "ai" });
  });

  it("falls back to Gemini when the Claude call fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 529,
        json: async () => ({}),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '[{"symbols":["ETH"],"impact":"bearish","score":40}]' }],
              },
            },
          ],
        }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    const out = await classifyMarketNews(["Ethereum drops"], MARKET_ASSETS, {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem-test",
    });

    expect(String(fetchMock.mock.calls[1][0])).toContain("generativelanguage.googleapis.com");
    expect(out[0]).toMatchObject({ symbols: ["ETH"], impact: "bearish", classifiedBy: "ai" });
  });

  it("degrades to the heuristic when every provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "",
      }),
    );
    const out = await classifyMarketNews(["Apple tumbles after downgrade"], MARKET_ASSETS, {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem-test",
    });
    expect(out[0].classifiedBy).toBe("heuristic");
    expect(out[0].impact).toBe("bearish");
  });

  it("keeps the input order and length even when the model answers short", async () => {
    // Model regularnie zwraca krótszą tablicę niż paczka. Brakujące pozycje
    // muszą dostać heurystykę, a nie przesunąć wszystkich o jeden.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: '[{"symbols":["BTC"],"impact":"bullish","score":60}]' }],
          usage: {},
        }),
        text: async () => "",
      }),
    );
    const out = await classifyMarketNews(
      ["Bitcoin up", "Apple tumbles after downgrade"],
      MARKET_ASSETS,
      {
        anthropicApiKey: "sk-test",
        geminiApiKey: null,
      },
    );
    expect(out).toHaveLength(2);
    expect(out[0].classifiedBy).toBe("ai");
    expect(out[1].classifiedBy).toBe("heuristic");
  });
});
