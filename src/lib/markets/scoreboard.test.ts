import { describe, expect, it } from "vitest";
import {
  buildScoreboard,
  FLAT_BAND_PCT,
  percentChange,
  resolveOutcome,
  flatBandPct,
  sessionsInHorizon,
  FLAT_BAND_MIN_PCT,
  FLAT_BAND_MAX_PCT,
  MINIMUM_MEANINGFUL_RESOLUTIONS,
} from "./scoreboard";

describe("resolveOutcome", () => {
  it("requires a real move, not just the absence of the opposite one", () => {
    // Zapowiedź wzrostu spełniona ruchem o 0,2% byłaby trafnością, której
    // nie da się zamienić na żadną decyzję.
    expect(resolveOutcome("up", 0.2)).toBe("miss");
    expect(resolveOutcome("up", FLAT_BAND_PCT)).toBe("hit");
    expect(resolveOutcome("down", -0.2)).toBe("miss");
    expect(resolveOutcome("down", -FLAT_BAND_PCT)).toBe("hit");
  });

  it("counts a quiet market as a hit for a flat call", () => {
    expect(resolveOutcome("flat", 0.4)).toBe("hit");
    expect(resolveOutcome("flat", -0.9)).toBe("hit");
    expect(resolveOutcome("flat", 1.5)).toBe("miss");
  });

  it("does not credit a call for a move in the opposite direction", () => {
    expect(resolveOutcome("up", -8)).toBe("miss");
    expect(resolveOutcome("down", 8)).toBe("miss");
  });
});

describe("percentChange", () => {
  it("computes the move from the price recorded at prediction time", () => {
    expect(percentChange(100, 110)).toBeCloseTo(10);
    expect(percentChange(100, 90)).toBeCloseTo(-10);
  });

  it("refuses to divide by a non-positive base", () => {
    expect(percentChange(0, 10)).toBeNull();
  });
});

const row = (over: Partial<Parameters<typeof buildScoreboard>[0][number]> = {}) => ({
  source: "signals" as const,
  direction: "up" as const,
  symbol: "BTC",
  outcome: "hit" as const,
  actualChangePct: 5,
  ...over,
});

describe("buildScoreboard", () => {
  it("splits the record by source so the model can be compared to plain arithmetic", () => {
    const board = buildScoreboard([
      row({ source: "signals", outcome: "hit" }),
      row({ source: "signals", outcome: "miss", actualChangePct: -3 }),
      row({ source: "ai", outcome: "hit" }),
      row({ source: "ai", outcome: "hit" }),
    ]);
    const ai = board.bySource.find((r) => r.key === "ai");
    const signals = board.bySource.find((r) => r.key === "signals");
    expect(ai?.hitRate).toBe(100);
    expect(signals?.hitRate).toBe(50);
  });

  it("leaves unresolved predictions out of the hit rate", () => {
    // Liczenie ich jako „jeszcze nie trafione" zaniżałoby wynik tym
    // mocniej, im świeższy jest moduł.
    const board = buildScoreboard([
      row({ outcome: "hit" }),
      row({ outcome: null, actualChangePct: null }),
      row({ outcome: null, actualChangePct: null }),
    ]);
    expect(board.resolved).toBe(1);
    expect(board.pending).toBe(2);
    expect(board.bySource[0].hitRate).toBe(100);
    expect(board.bySource[0].resolved).toBe(1);
  });

  it("returns null hit rate rather than 0 when nothing is resolved yet", () => {
    const board = buildScoreboard([row({ outcome: null, actualChangePct: null })]);
    expect(board.bySource).toEqual([]);
    expect(board.resolved).toBe(0);
  });

  it("averages the actual move, skipping rows that have none", () => {
    const board = buildScoreboard([
      row({ actualChangePct: 10 }),
      row({ actualChangePct: 20 }),
      row({ outcome: "miss", actualChangePct: null }),
    ]);
    expect(board.bySource[0].avgChangePct).toBeCloseTo(15);
    expect(board.bySource[0].resolved).toBe(3);
  });

  it("carries the significance threshold so the UI can qualify small samples", () => {
    // Trafność 100% z trzech prognoz to nie jest wynik i panel musi to
    // powiedzieć wprost.
    expect(buildScoreboard([]).minimumMeaningful).toBe(MINIMUM_MEANINGFUL_RESOLUTIONS);
  });

  it("ranks the busiest dimension first", () => {
    const board = buildScoreboard([
      row({ symbol: "ETH" }),
      row({ symbol: "BTC" }),
      row({ symbol: "BTC", outcome: "miss", actualChangePct: -2 }),
    ]);
    expect(board.bySymbol[0].key).toBe("BTC");
  });
});

describe("flatBandPct", () => {
  it("spokojny instrument dostaje wąskie pasmo, zmienny szerokie", () => {
    // EURPLN ~5% rocznie, 5 sesji → σ ≈ 0,7% → pasmo ≈ 0,35%.
    const fx = flatBandPct(5, 5);
    // BTC ~50% rocznie, 7 sesji → σ ≈ 8,3% → pasmo ≈ 4,2%.
    const btc = flatBandPct(50, 7);
    expect(fx).toBeGreaterThan(0.3);
    expect(fx).toBeLessThan(0.4);
    expect(btc).toBeGreaterThan(4);
    expect(btc).toBeLessThan(4.5);
  });

  it("bez zmienności wraca do stałego progu", () => {
    expect(flatBandPct(null, 5)).toBe(FLAT_BAND_PCT);
    expect(flatBandPct(0, 5)).toBe(FLAT_BAND_PCT);
    expect(flatBandPct(Number.NaN, 5)).toBe(FLAT_BAND_PCT);
  });

  it("trzyma się granic przy skrajnych seriach", () => {
    expect(flatBandPct(0.1, 5)).toBe(FLAT_BAND_MIN_PCT);
    expect(flatBandPct(500, 7)).toBe(FLAT_BAND_MAX_PCT);
  });
});

describe("sessionsInHorizon", () => {
  it("krypto liczy każdy dzień, reszta dni robocze", () => {
    expect(sessionsInHorizon(7, "crypto")).toBe(7);
    expect(sessionsInHorizon(7, "equity")).toBe(5);
  });
});

describe("resolveOutcome z pasmem instrumentu", () => {
  it("ten sam ruch +2% to trafiony wzrost dla EURPLN, a trafione „bez zmian” dla BTC", () => {
    expect(resolveOutcome("up", 2, 0.35)).toBe("hit");
    expect(resolveOutcome("flat", 2, 4.2)).toBe("hit");
    expect(resolveOutcome("up", 2, 4.2)).toBe("miss");
  });
});

describe("buildScoreboard — porównanie ze starą regułą", () => {
  it("liczy trafność wg ±1% obok bieżącej", () => {
    const board = buildScoreboard([
      {
        source: "ai",
        direction: "flat",
        symbol: "BTC",
        outcome: "hit",
        actualChangePct: 2,
        outcomeFixedBand: "miss",
      },
      {
        source: "ai",
        direction: "up",
        symbol: "BTC",
        outcome: "hit",
        actualChangePct: 5,
        outcomeFixedBand: "hit",
      },
    ]);
    expect(board.bySource[0].hitRate).toBe(100);
    expect(board.bySourceFixedBand[0].hitRate).toBe(50);
  });
});
