import { describe, expect, it } from "vitest";
import {
  accuracyHeadline,
  breadth,
  fundHeadline,
  instrumentGroups,
  newsMood,
} from "./marketsDigest";

describe("markets digest", () => {
  it("groups the catalog by category, watched first, skipping empty ones", () => {
    const groups = instrumentGroups(
      [
        { symbol: "BTC", label: "Bitcoin", assetClass: "crypto" },
        { symbol: "ETH", label: "Ethereum", assetClass: "crypto" },
        { symbol: "CDR", label: "CD Projekt", assetClass: "equity" },
      ],
      new Set(["ETH"]),
      new Map([["ETH", { last: 3000, change1d: 1.2, currency: "USD" }]]),
    );
    expect(groups.map((g) => g.label)).toEqual(["Akcje", "Krypto"]);
    expect(groups[1].rows.map((r) => r.symbol)).toEqual(["ETH", "BTC"]);
    expect(groups[1].rows[0]).toMatchObject({ watched: true, last: 3000, change1d: 1.2 });
    expect(groups[1].rows[1]).toMatchObject({ watched: false, last: null });
  });

  it("counts the market today", () => {
    const b = breadth([
      { label: "A", stats: { change1d: 2 } },
      { label: "B", stats: { change1d: -1 } },
      { label: "C", stats: { change1d: 0 } },
      { label: "D", stats: { change1d: null } },
    ]);
    expect(b).toMatchObject({ up: 1, down: 1, flat: 1, known: 3 });
    expect(b.top?.label).toBe("A");
    expect(b.bottom?.label).toBe("B");
  });

  it("names the fund's leader against the basket, ignoring waiting players", () => {
    const h = fundHeadline([
      { key: "ai", label: "AI", kind: "source", metrics: { returnPct: 1.5, trades: 4 } },
      { key: "x", label: "Czeka", kind: "source", metrics: { returnPct: 9, trades: 0 } },
      { key: "b", label: "Koszyk", kind: "benchmark", metrics: { returnPct: 2, trades: 1 } },
    ]);
    expect(h).toEqual({ label: "AI", returnPct: 1.5, basketPct: 2, beatsBasket: false });
    expect(fundHeadline([])).toBeNull();
  });

  it("says how often the forecasts hit, only once it means something", () => {
    const board = {
      minimumMeaningful: 20,
      bySource: [
        { key: "ai_learned·2", hitRate: 47, resolved: 40 },
        { key: "signals·2", hitRate: 60, resolved: 5 },
        { key: "ai·7", hitRate: 70, resolved: 90 },
      ],
    };
    expect(accuracyHeadline(board)).toEqual({
      meaningful: true,
      name: "AI z wnioskami",
      hitRate: 47,
      outOfTen: 5,
      resolved: 40,
    });
    expect(
      accuracyHeadline({
        minimumMeaningful: 20,
        bySource: [{ key: "ai·2", hitRate: 80, resolved: 3 }],
      }),
    ).toEqual({ meaningful: false, settled: 3, needed: 20 });
  });

  it("reads the mood of the news", () => {
    expect(newsMood([{ impact: "bullish" }, { impact: "bullish" }, { impact: "bearish" }])).toEqual(
      {
        up: 2,
        down: 1,
        neutral: 0,
        lean: "up",
      },
    );
    expect(newsMood([])).toBeNull();
  });
});
