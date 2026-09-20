import { describe, expect, it, vi, afterEach } from "vitest";
import { assetBySymbol } from "./assets";
import { computeSignals, scoreSignals } from "./signals";
import {
  describeForModel,
  forecastWithModel,
  normalizeAiVerdict,
  type ForecastInput,
} from "./forecast.server";
import type { PricePoint } from "./series";

afterEach(() => {
  vi.restoreAllMocks();
});

const rising = (n: number): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    close: 100 + i,
  }));

const input = (symbol: string, points = rising(80)): ForecastInput => ({
  asset: assetBySymbol(symbol)!,
  technical: scoreSignals(computeSignals(points)),
  sentimentScore: 40,
  sentimentItems: 3,
  headlines: ["Coś się wydarzyło"],
  lastPrice: points[points.length - 1].close,
});

describe("describeForModel", () => {
  it("hands the model computed values instead of asking it to compute them", () => {
    const text = describeForModel(input("BTC"));
    expect(text).toContain("RSI(14):");
    expect(text).toContain("momentum 20 sesji:");
    expect(text).toContain("wynik sygnałów:");
  });

  it("says 'brak' rather than inventing a value the series cannot support", () => {
    // Krótka seria nie ma SMA50 — model musi zobaczyć „brak", a nie liczbę.
    const text = describeForModel(input("BTC", rising(25)));
    expect(text).toContain("SMA20 vs SMA50: brak");
  });

  it("rounds the price instead of pasting a raw float into the prompt", () => {
    // „81160.9500675369" sugeruje modelowi dokładność, której notowanie nie
    // ma, i zjada tokeny bez żadnej wartości.
    const base = input("BTC");
    const text = describeForModel({ ...base, lastPrice: 81160.9500675369 });
    expect(text).toContain("cena: 81160.95");
    expect(text).not.toContain("81160.9500675369");
  });

  it("marks the absence of news explicitly", () => {
    const text = describeForModel({ ...input("BTC"), sentimentScore: null, sentimentItems: 0 });
    expect(text).toContain("wydźwięk newsów: brak newsów");
  });
});

describe("normalizeAiVerdict", () => {
  it("accepts a well-formed verdict", () => {
    const v = normalizeAiVerdict(
      { symbol: "BTC", direction: "down", confidence: 65, rationale_pl: "Bo tak." },
      input("BTC"),
    );
    expect(v).toEqual({ symbol: "BTC", direction: "down", confidence: 65, rationalePl: "Bo tak." });
  });

  it("falls back to the signal verdict, not to a made-up neutral one", () => {
    // „flat z pewnością 50" podpisane jako ocena modelu byłoby wymyśloną
    // prognozą i zafałszowałoby panel skuteczności.
    const base = input("BTC");
    const v = normalizeAiVerdict({ direction: "maybe up" }, base);
    expect(v.direction).toBe(base.technical.direction);
    expect(v.confidence).toBe(base.technical.confidence);
    expect(v.rationalePl).toBeNull();
  });

  it("clamps a confidence outside the promised range", () => {
    expect(normalizeAiVerdict({ direction: "up", confidence: 500 }, input("BTC")).confidence).toBe(
      100,
    );
    expect(normalizeAiVerdict({ direction: "up", confidence: -10 }, input("BTC")).confidence).toBe(
      0,
    );
  });

  it("keeps the symbol from our own catalog, not from the model", () => {
    const v = normalizeAiVerdict({ symbol: "TSLA", direction: "up", confidence: 10 }, input("BTC"));
    expect(v.symbol).toBe("BTC");
  });
});

describe("forecastWithModel", () => {
  it("returns signal verdicts and no model name when no key is configured", async () => {
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: null,
      geminiApiKey: null,
    });
    expect(result.model).toBeNull();
    expect(result.verdicts[0].direction).toBe("up");
  });

  it("matches verdicts by symbol, not by position", async () => {
    // Model bywa kreatywny z kolejnością. Przesunięcie o jeden przypisałoby
    // ocenę Bitcoina do złota — błąd cichy i kompletnie mylący.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { symbol: "XAUUSD", direction: "down", confidence: 30, rationale_pl: "Złoto." },
                { symbol: "BTC", direction: "up", confidence: 80, rationale_pl: "Bitcoin." },
              ]),
            },
          ],
          usage: {},
        }),
        text: async () => "",
      }),
    );

    const result = await forecastWithModel([input("BTC"), input("XAUUSD")], {
      anthropicApiKey: "sk-test",
      geminiApiKey: null,
    });

    expect(result.verdicts[0]).toMatchObject({ symbol: "BTC", direction: "up", confidence: 80 });
    expect(result.verdicts[1]).toMatchObject({ symbol: "XAUUSD", direction: "down" });
  });

  it("reports which model actually answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: '[{"symbol":"BTC","direction":"up","confidence":70}]' }],
          usage: {},
        }),
        text: async () => "",
      }),
    );
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: "sk-test",
      geminiApiKey: null,
    });
    expect(result.model).toBe("claude-opus-5");
  });

  it("falls back to Gemini and names it when Claude fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
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
                  parts: [{ text: '[{"symbol":"BTC","direction":"flat","confidence":20}]' }],
                },
              },
            ],
          }),
          text: async () => "",
        }),
    );
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem",
    });
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.verdicts[0].direction).toBe("flat");
  });

  it("degrades to signals with no model name when every provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => "",
      }),
    );
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem",
    });
    expect(result.model).toBeNull();
  });
});
