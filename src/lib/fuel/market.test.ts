import { describe, expect, it } from "vitest";
import {
  brentToPlnPerM3,
  buildNbpUsdUrl,
  joinSeries,
  parseNbpRates,
  parseYahooChart,
} from "./market";

describe("parseYahooChart", () => {
  it("wyciąga dzienne zamknięcia i sortuje rosnąco", () => {
    const payload = {
      chart: {
        result: [
          {
            timestamp: [1789430400, 1789516800, 1789603200],
            indicators: { quote: [{ close: [98.1, 99.4, 99.29] }] },
          },
        ],
      },
    };
    const series = parseYahooChart(payload);
    expect(series).toHaveLength(3);
    expect(series[0].date < series[2].date).toBe(true);
    expect(series[2].value).toBe(99.29);
  });

  it("pomija dni bez sesji (close = null) zamiast wstawiać zera", () => {
    const series = parseYahooChart({
      chart: {
        result: [
          {
            timestamp: [1789430400, 1789516800],
            indicators: { quote: [{ close: [null, 99.4] }] },
          },
        ],
      },
    });
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(99.4);
  });

  it("zwraca pustą serię dla nieznanego kształtu odpowiedzi", () => {
    expect(parseYahooChart({ chart: { error: "nope" } })).toEqual([]);
    expect(parseYahooChart(null)).toEqual([]);
  });
});

describe("parseNbpRates", () => {
  it("parsuje odpowiedź tabeli A", () => {
    // Realna odpowiedź api.nbp.pl (sprawdzona 19.09.2026).
    const series = parseNbpRates({
      table: "A",
      code: "USD",
      rates: [
        { no: "181/A/NBP/2026", effectiveDate: "2026-09-17", mid: 3.803 },
        { no: "182/A/NBP/2026", effectiveDate: "2026-09-18", mid: 3.7998 },
      ],
    });
    expect(series).toEqual([
      { date: "2026-09-17", value: 3.803 },
      { date: "2026-09-18", value: 3.7998 },
    ]);
  });

  it("odrzuca wiersze bez poprawnego kursu", () => {
    const series = parseNbpRates({
      rates: [
        { effectiveDate: "2026-09-17", mid: "brak" },
        { effectiveDate: "2026-09-18", mid: 0 },
        { effectiveDate: "2026-09-19", mid: 3.81 },
      ],
    });
    expect(series).toHaveLength(1);
  });
});

describe("buildNbpUsdUrl", () => {
  it("przycina liczbę notowań do limitu NBP", () => {
    expect(buildNbpUsdUrl(1000)).toContain("/last/255/");
    expect(buildNbpUsdUrl(0)).toContain("/last/1/");
  });
});

describe("brentToPlnPerM3", () => {
  it("przelicza baryłkę w USD na metr sześcienny w PLN", () => {
    // 99.29 USD/bbl × 3.7998 PLN/USD ÷ 0.158987 m³/bbl ≈ 2373 PLN/m³
    expect(brentToPlnPerM3(99.29, 3.7998)).toBeCloseTo(2373.0, 0);
  });

  it("skaluje liniowo względem kursu", () => {
    expect(brentToPlnPerM3(100, 8)).toBeCloseTo(brentToPlnPerM3(100, 4) * 2, 1);
  });
});

describe("joinSeries", () => {
  it("przenosi ostatni znany kurs na dni bez notowania NBP", () => {
    const joined = joinSeries(
      [
        { date: "2026-09-18", value: 100 },
        { date: "2026-09-19", value: 102 },
      ],
      [{ date: "2026-09-18", value: 4 }],
    );
    expect(joined).toHaveLength(2);
    expect(joined[1].usdPln).toBe(4);
    expect(joined[1].brentPlnPerM3).toBeCloseTo(brentToPlnPerM3(102, 4), 2);
  });

  it("pomija dni sprzed pierwszego znanego kursu", () => {
    const joined = joinSeries(
      [
        { date: "2026-09-10", value: 100 },
        { date: "2026-09-18", value: 102 },
      ],
      [{ date: "2026-09-15", value: 4 }],
    );
    expect(joined.map((p) => p.date)).toEqual(["2026-09-18"]);
  });

  it("zwraca pustą tablicę, gdy brakuje którejkolwiek serii", () => {
    expect(joinSeries([], [{ date: "2026-09-18", value: 4 }])).toEqual([]);
    expect(joinSeries([{ date: "2026-09-18", value: 100 }], [])).toEqual([]);
  });
});
