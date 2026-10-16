import { describe, expect, it } from "vitest";
import { classifyRegime, isMarketRegime } from "./regime";
import type { TechnicalSignals } from "./signals";

const base: TechnicalSignals = {
  rsi: 55,
  sma20: 100,
  sma50: 100,
  distanceFromSma20: 0,
  momentum5: 0,
  momentum20: 0,
  volatility: 30,
  rangePosition: 50,
  points: 80,
};

describe("classifyRegime", () => {
  it("splecione średnie to brak trendu, niezależnie od ostatnich sesji", () => {
    expect(classifyRegime({ ...base, sma20: 100.5, momentum5: 3 })).toBe("sideways");
  });

  it("trend trwa, gdy ostatnie sesje idą z prądem", () => {
    expect(classifyRegime({ ...base, sma20: 106, momentum5: 2 })).toBe("uptrend");
    expect(classifyRegime({ ...base, sma20: 94, momentum5: -2 })).toBe("downtrend");
  });

  it("BTC z października: średnie wciąż wzrostowe, cena już nie — korekta, nie trend", () => {
    expect(classifyRegime({ ...base, sma20: 105, momentum5: -1.4 })).toBe("uptrend_pullback");
    expect(classifyRegime({ ...base, sma20: 95, momentum5: 1.2 })).toBe("downtrend_bounce");
  });

  it("za krótka seria nie dostaje zgadywanego reżimu", () => {
    expect(classifyRegime({ ...base, sma50: null })).toBeNull();
    expect(classifyRegime({ ...base, momentum5: null })).toBeNull();
  });
});

describe("isMarketRegime", () => {
  it("rozpoznaje tylko znane wartości", () => {
    expect(isMarketRegime("uptrend")).toBe(true);
    expect(isMarketRegime("trend")).toBe(false);
    expect(isMarketRegime(null)).toBe(false);
  });
});
