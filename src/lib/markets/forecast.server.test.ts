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
import { createModelBudget } from "./budget";
import { makeDb } from "@/lib/agents/runtime.testkit";

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
    expect(text).toContain("RSI14 ");
    expect(text).toContain("mom20 ");
    expect(text).toContain("sygnały ");
    // Jedna linia na instrument — skróty objaśnia HORIZONS_BLOCK.
    expect(text).not.toContain("\n");
  });

  it("says 'brak' rather than inventing a value the series cannot support", () => {
    // Krótka seria nie ma SMA50 — model musi zobaczyć „brak", a nie liczbę.
    const text = describeForModel(input("BTC", rising(25)));
    expect(text).toContain("SMA20/50 brak");
  });

  it("rounds the price instead of pasting a raw float into the prompt", () => {
    // „81160.9500675369" sugeruje modelowi dokładność, której notowanie nie
    // ma, i zjada tokeny bez żadnej wartości.
    const base = input("BTC");
    const text = describeForModel({ ...base, lastPrice: 81160.9500675369 });
    expect(text).toContain("cena 81160.95");
    expect(text).not.toContain("81160.9500675369");
  });

  it("tells the model the flat band it will be scored against", () => {
    expect(describeForModel({ ...input("BTC"), flatBandPct: 4.2 })).toContain("pasmo 2d ±4.20%");
    expect(describeForModel({ ...input("BTC"), flatBandPct: 2.1, controlBandPct: 4.2 })).toContain(
      "pasmo 2d ±2.10%, pasmo 7d ±4.20%",
    );
    expect(describeForModel(input("BTC"))).not.toContain("pasmo");
  });

  it("shows the market situation only to the learning variant", () => {
    const withRegime = { ...input("BTC"), regime: "uptrend" };
    expect(describeForModel(withRegime)).not.toContain("sytuacja");
    expect(describeForModel(withRegime, { withRegime: true })).toContain(
      "sytuacja: trend wzrostowy",
    );
  });

  it("marks the absence of news explicitly", () => {
    const text = describeForModel({ ...input("BTC"), sentimentScore: null, sentimentItems: 0 });
    expect(text).toContain("newsy: brak");
  });
});

describe("normalizeAiVerdict", () => {
  it("accepts a well-formed verdict", () => {
    const v = normalizeAiVerdict(
      { symbol: "BTC", direction: "down", confidence: 65, rationale_pl: "Bo tak." },
      input("BTC"),
    );
    expect(v).toEqual({
      symbol: "BTC",
      direction: "down",
      confidence: 65,
      rationalePl: "Bo tak.",
      control: null,
    });
  });

  it("reads the 7-day control forecast only when the model gave it", () => {
    const v = normalizeAiVerdict(
      { direction: "up", confidence: 60, direction_7d: "down", confidence_7d: 140 },
      input("BTC"),
    );
    expect(v.control).toEqual({ direction: "down", confidence: 100 });
    expect(
      normalizeAiVerdict({ direction: "up", confidence: 60 }, input("BTC")).control,
    ).toBeNull();
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

describe("forecastWithModel — budżet", () => {
  it("does not call the model when the token budget says no", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await forecastWithModel(
      [input("BTC")],
      { anthropicApiKey: "k", geminiApiKey: null },
      { budget: { check: async () => "budżet dzienny: wyczerpany", record: async () => {} } },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.model).toBeNull();
    expect(result.failure).toContain("budżet tokenów");
    vi.unstubAllGlobals();
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
    expect(result.model).toBe("claude-opus-5-5");
  });

  it("falls back to Gemini and names it when Claude fails", async () => {
    // Odpowiedź po adresie, nie po kolejności: klient modeli ponawia raz po 5xx.
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes("api.anthropic.com")
        ? { ok: false, status: 500, json: async () => ({}), text: async () => "" }
        : {
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
          },
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: "sk-test",
      geminiApiKey: "gem",
    });
    expect(result.model).toBe("gemini-2.5-flash");
    // Claude: pierwsza próba + jedno ponowienie po 500, potem Gemini.
    const claudeCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.anthropic.com"),
    );
    expect(claudeCalls).toHaveLength(2);
    expect(result.verdicts[0].direction).toBe("flat");
  });

  it("sends lessons only in the learning variant", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: '[{"symbol":"BTC","direction":"flat","confidence":30}]' }] },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const keys = { anthropicApiKey: null, geminiApiKey: "gem" };

    await forecastWithModel([input("BTC")], keys);
    await forecastWithModel([input("BTC")], keys, {
      lessons: ["Prognozy wzrostu trafiły 5 z 69 razy."],
    });

    const control = JSON.parse(fetchMock.mock.calls[0][1].body).systemInstruction.parts[0].text;
    const learned = JSON.parse(fetchMock.mock.calls[1][1].body).systemInstruction.parts[0].text;
    expect(control).not.toContain("WNIOSKI");
    expect(learned).toContain("WNIOSKI Z TWOICH ROZLICZONYCH PROGNOZ");
    expect(learned).toContain("5 z 69");
  });

  it("says why there is no model verdict when keys were given", async () => {
    // Bez powodu prognozy „ai" znikały na tygodnie po cichu.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            { finishReason: "MAX_TOKENS", content: { parts: [{ text: '[{"symbol":"BTC"' }] } },
          ],
        }),
        text: async () => "",
      }),
    );
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: null,
      geminiApiKey: "gem",
    });
    expect(result.model).toBeNull();
    expect(result.failure).toContain("MAX_TOKENS");
  });

  it("has no failure when no key was configured — that is a choice, not an error", async () => {
    const result = await forecastWithModel([input("BTC")], {
      anthropicApiKey: null,
      geminiApiKey: null,
    });
    expect(result.failure).toBeNull();
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

// Etap 2: moduł rynków pisze równolegle do księgi llm_usage.
describe("forecastWithModel — księga llm_usage", () => {
  it("prognoza modelem zostawia wiersz w llm_usage obok market_model_usage", async () => {
    const { db, calls } = makeDb(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
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
          usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 },
        }),
        text: async () => "",
      }),
    );
    await forecastWithModel(
      [input("BTC")],
      { anthropicApiKey: null, geminiApiKey: "gem" },
      {
        budget: createModelBudget(db, "owner-1"),
      },
    );
    const inserted = calls
      .filter((c) => c.ops.some((o) => o.method === "insert"))
      .map((c) => c.table);
    expect(inserted).toContain("market_model_usage");
    const row = calls.find((c) => c.table === "llm_usage")?.ops.find((o) => o.method === "insert")
      ?.args[0] as Record<string, unknown> | undefined;
    expect(row).toMatchObject({
      owner_id: "owner-1",
      module: "markets",
      purpose: "forecast",
      provider: "gemini",
      tokens_input: 300,
      tokens_output: 40,
    });
  });
});
