import { describe, expect, it } from "vitest";
import {
  annualizedVolatility,
  changeOverSessions,
  computeSeriesStats,
  formatPercent,
  formatPrice,
  normalizeSeries,
  rebaseToHundred,
  type PricePoint,
} from "./series";

const series = (...closes: number[]): PricePoint[] =>
  closes.map((close, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    close,
  }));

describe("normalizeSeries", () => {
  it("sorts by date and lets a later read correct an earlier one", () => {
    const out = normalizeSeries([
      { date: "2026-09-03", close: 30 },
      { date: "2026-09-01", close: 10 },
      { date: "2026-09-01", close: 11 },
    ]);
    expect(out).toEqual([
      { date: "2026-09-01", close: 11 },
      { date: "2026-09-03", close: 30 },
    ]);
  });

  it("drops points an API can legitimately hand back but a chart cannot use", () => {
    const out = normalizeSeries([
      { date: "2026-09-01", close: 10 },
      { date: "2026-09-02", close: 0 },
      { date: "2026-09-03", close: Number.NaN },
      { date: "03/09/2026", close: 12 },
    ] as PricePoint[]);
    expect(out).toEqual([{ date: "2026-09-01", close: 10 }]);
  });
});

describe("changeOverSessions", () => {
  it("counts sessions, not calendar days", () => {
    // 5 sesji wstecz od ostatniego punktu = pierwszy punkt tej serii.
    expect(changeOverSessions(series(100, 101, 102, 103, 104, 110), 5)).toBeCloseTo(10);
  });

  it("clamps to the oldest point instead of returning null on a short series", () => {
    expect(changeOverSessions(series(100, 120), 30)).toBeCloseTo(20);
  });

  it("has nothing to compare on a single point", () => {
    expect(changeOverSessions(series(100), 1)).toBeNull();
  });
});

describe("computeSeriesStats", () => {
  it("reports the latest close and its date", () => {
    const stats = computeSeriesStats(series(10, 11, 12));
    expect(stats.last).toBe(12);
    expect(stats.lastDate).toBe("2026-09-03");
    expect(stats.previous).toBe(11);
    expect(stats.change1d).toBeCloseTo(9.0909, 3);
  });

  it("uses a 7-day week for crypto and a 5-day one for equities", () => {
    // Ta sama seria, inna klasa aktywów: „tydzień" sięga innego punktu.
    const points = series(100, 101, 102, 103, 104, 105, 106, 107);
    const equity = computeSeriesStats(points, 5);
    const crypto = computeSeriesStats(points, 7);
    expect(equity.change7d).not.toBeCloseTo(crypto.change7d ?? 0);
  });

  it("places the last price inside its 30-session range", () => {
    const stats = computeSeriesStats(series(10, 20, 15));
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(20);
    expect(stats.rangePosition).toBeCloseTo(50);
  });

  it("returns an empty, non-throwing shape for an empty series", () => {
    const stats = computeSeriesStats([]);
    expect(stats.points).toBe(0);
    expect(stats.last).toBeNull();
    expect(stats.rangePosition).toBeNull();
  });

  it("gives a flat series no range position rather than dividing by zero", () => {
    expect(computeSeriesStats(series(50, 50, 50)).rangePosition).toBeNull();
  });
});

describe("annualizedVolatility", () => {
  it("is zero for a perfectly flat series and positive for a jumpy one", () => {
    expect(annualizedVolatility(series(10, 10, 10, 10, 10, 10))).toBeCloseTo(0);
    const jumpy = annualizedVolatility(series(10, 12, 9, 13, 8, 14));
    expect(jumpy).not.toBeNull();
    expect(jumpy as number).toBeGreaterThan(50);
  });

  it("declines to guess from too few points", () => {
    expect(annualizedVolatility(series(10, 11))).toBeNull();
  });
});

describe("rebaseToHundred", () => {
  it("puts instruments of wildly different magnitudes on one axis", () => {
    const out = rebaseToHundred(series(80000, 88000));
    expect(out.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(out[0].value).toBeCloseTo(100);
    expect(out[1].value).toBeCloseTo(110);
  });
});

describe("formatting", () => {
  it("scales decimals to the order of magnitude", () => {
    expect(formatPrice(81234.5, "USD")).toMatch(/^81\s?235 USD$/u);
    expect(formatPrice(0.4213456, "USD")).toContain("0,42135");
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("always signs a gain", () => {
    expect(formatPercent(2.5)).toBe("+2.50%");
    expect(formatPercent(-2.5)).toBe("-2.50%");
    expect(formatPercent(null)).toBe("—");
  });
});
