import { describe, expect, it } from "vitest";
import {
  parseCoinGeckoChart,
  parseFrankfurterSeries,
  parseStooqCsv,
  parseYahooChart,
} from "./parse";

describe("parseStooqCsv", () => {
  it("reads the Close column by name, not by position", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-09-17,100,105,99,104,12000\n";
    expect(parseStooqCsv(csv)).toEqual([{ date: "2026-09-17", close: 104 }]);
  });

  it("returns nothing when Stooq answers with its anti-bot HTML page", () => {
    // Zaobserwowane na żywo: HTTP 200, treść to strona HTML z wyzwaniem JS.
    // Gdyby to przeszło jako dane, do cache'u trafiłyby śmieci zamiast
    // sygnału „spróbuj następnego dostawcy".
    expect(parseStooqCsv('<!DOCTYPE html><html><head><meta charset="utf-8">')).toEqual([]);
  });

  it("skips rows with no close (holiday / unfinished session)", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-09-17,100,105,99,,0\n2026-09-18,1,1,1,7,1\n";
    expect(parseStooqCsv(csv)).toEqual([{ date: "2026-09-18", close: 7 }]);
  });

  it("rejects a body that is neither CSV nor HTML", () => {
    expect(parseStooqCsv("N/D")).toEqual([]);
    expect(parseStooqCsv("")).toEqual([]);
  });
});

describe("parseYahooChart", () => {
  it("drops null closes instead of charting them as zero", () => {
    const raw = {
      chart: {
        result: [
          {
            timestamp: [1789776000, 1789862400, 1789948800],
            indicators: { quote: [{ close: [10, null, 12] }] },
          },
        ],
      },
    };
    expect(parseYahooChart(raw).map((p) => p.close)).toEqual([10, 12]);
  });

  it("survives an error payload without throwing", () => {
    expect(parseYahooChart({ chart: { result: null, error: "Not Found" } })).toEqual([]);
    expect(parseYahooChart(null)).toEqual([]);
  });
});

describe("parseCoinGeckoChart", () => {
  it("converts millisecond stamps to ISO dates", () => {
    const raw = { prices: [[1789776000000, 80873.58]] };
    expect(parseCoinGeckoChart(raw)).toEqual([{ date: "2026-09-19", close: 80873.58 }]);
  });

  it("ignores malformed rows", () => {
    expect(parseCoinGeckoChart({ prices: [[1789776000000], "x", [1789776000000, 0]] })).toEqual([]);
  });
});

describe("parseFrankfurterSeries", () => {
  it("picks the requested quote currency out of each day", () => {
    const raw = { rates: { "2026-09-10": { PLN: 3.7207 }, "2026-09-11": { PLN: 3.731 } } };
    expect(parseFrankfurterSeries(raw, "PLN")).toEqual([
      { date: "2026-09-10", close: 3.7207 },
      { date: "2026-09-11", close: 3.731 },
    ]);
  });

  it("returns nothing when the day carries a different currency", () => {
    expect(parseFrankfurterSeries({ rates: { "2026-09-10": { EUR: 0.9 } } }, "PLN")).toEqual([]);
  });
});
