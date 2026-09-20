import { describe, expect, it } from "vitest";
import {
  combineOutlook,
  computeRsi,
  computeSignals,
  scoreSignals,
  type TechnicalSignals,
} from "./signals";
import type { PricePoint } from "./series";

/** Seria dzienna od 2026-01-01, tyle punktów ile podanych cen. */
const series = (closes: number[]): PricePoint[] =>
  closes.map((close, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return { date: d.toISOString().slice(0, 10), close };
  });

const rising = (n: number, start = 100, step = 1): PricePoint[] =>
  series(Array.from({ length: n }, (_, i) => start + i * step));

const falling = (n: number, start = 200, step = 1): PricePoint[] =>
  series(Array.from({ length: n }, (_, i) => start - i * step));

describe("computeRsi", () => {
  it("is 100 for a series that only ever rises", () => {
    // Brak jednego spadku znaczy zerową średnią strat — to poprawny wynik,
    // nie dzielenie przez zero.
    expect(computeRsi(rising(30))).toBe(100);
  });

  it("is near 0 for a series that only ever falls", () => {
    expect(computeRsi(falling(30))).toBeCloseTo(0, 5);
  });

  it("sits near the middle for an oscillating series", () => {
    const zigzag = series(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1)));
    const rsi = computeRsi(zigzag);
    expect(rsi).not.toBeNull();
    expect(rsi as number).toBeGreaterThan(30);
    expect(rsi as number).toBeLessThan(70);
  });

  it("declines to answer on too short a series", () => {
    expect(computeRsi(rising(10))).toBeNull();
  });

  it("returns 50 for a perfectly flat series rather than 100", () => {
    // Brak ruchu to brak sygnału w którąkolwiek stronę.
    expect(computeRsi(series(Array(30).fill(100)))).toBe(50);
  });
});

describe("computeSignals", () => {
  it("reports both moving averages once the series is long enough", () => {
    const s = computeSignals(rising(60));
    expect(s.sma20).not.toBeNull();
    expect(s.sma50).not.toBeNull();
    // W trendzie wzrostowym krótsza średnia jest nad dłuższą.
    expect(s.sma20 as number).toBeGreaterThan(s.sma50 as number);
  });

  it("leaves the long average null when there is not enough history", () => {
    const s = computeSignals(rising(30));
    expect(s.sma20).not.toBeNull();
    expect(s.sma50).toBeNull();
  });

  it("measures momentum in sessions back from the last point", () => {
    const s = computeSignals(rising(30, 100, 1));
    // 20 sesji wstecz to cena niższa o 20 przy kroku 1.
    expect(s.momentum20).toBeCloseTo((20 / (100 + 9)) * 100, 1);
  });

  it("puts the last price at the top of its range in an uptrend", () => {
    expect(computeSignals(rising(60)).rangePosition).toBeCloseTo(100);
  });

  it("returns an empty, non-throwing shape for an empty series", () => {
    const s = computeSignals([]);
    expect(s.points).toBe(0);
    expect(s.rsi).toBeNull();
    expect(s.rangePosition).toBeNull();
  });
});

describe("scoreSignals", () => {
  it("calls a steady uptrend up", () => {
    const out = scoreSignals(computeSignals(rising(80)));
    expect(out.direction).toBe("up");
    expect(out.score).toBeGreaterThan(0);
  });

  it("calls a steady downtrend down", () => {
    const out = scoreSignals(computeSignals(falling(80)));
    expect(out.direction).toBe("down");
    expect(out.score).toBeLessThan(0);
  });

  it("calls a flat market flat instead of inventing a direction", () => {
    // Lekko dodatnia wypadkowa to szum, nie sygnał — nazwanie go wzrostem
    // byłoby wprowadzaniem w błąd.
    const out = scoreSignals(computeSignals(series(Array(80).fill(100))));
    expect(out.direction).toBe("flat");
    expect(out.confidence).toBeLessThanOrEqual(40);
  });

  it("dampens an overbought rally without cancelling it", () => {
    // Regresja na realny błąd wykrytego testem projektu: przy poprzedniej
    // wersji (RSI jako osobny, przeciwny wkład) nieprzerwany trend
    // wzrostowy dostawał wynik 14 i etykietę „bez kierunku". RSI ma tłumić,
    // nie znosić — żeby odwrócić kierunek, musi zawrócić cena.
    const out = scoreSignals(computeSignals(rising(80)));
    const rsiDriver = out.drivers.find((d) => d.label === "RSI 14");
    expect(rsiDriver?.contribution).toBeLessThan(0);
    expect(out.direction).toBe("up");
    expect(out.score).toBeGreaterThan(25);
  });

  it("keeps the drivers reconciling with the score it reports", () => {
    // Panel pokazuje wkłady obok wyniku — gdyby się nie sumowały, lista
    // przesłanek byłaby ozdobą, a nie wyjaśnieniem.
    const out = scoreSignals(computeSignals(rising(80)));
    const sum = out.drivers.reduce((acc, d) => acc + d.contribution, 0);
    expect(sum).toBeCloseTo(out.score, 0);
  });

  it("does not dampen when the stretch argues FOR the direction", () => {
    // RSI 100 przy spadkach nie jest argumentem przeciw spadkom, więc nie
    // może ich tłumić. Sprawdzamy to na trendzie spadkowym: tam RSI jest
    // niskie i to ONO tłumi, a pozycja w zakresie także.
    const out = scoreSignals(computeSignals(falling(80)));
    const rsiDriver = out.drivers.find((d) => d.label === "RSI 14");
    // Tłumienie jest zawsze przeciwne do kierunku — przy spadku dodatnie.
    expect(out.direction).toBe("down");
    expect(rsiDriver?.contribution ?? 0).toBeGreaterThan(0);
  });

  it("never leaves the -100..100 range even on an extreme series", () => {
    const out = scoreSignals(computeSignals(rising(120, 10, 5)));
    expect(out.score).toBeGreaterThanOrEqual(-100);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(95);
  });

  it("gives a short history lower confidence than a long one", () => {
    const short = scoreSignals(computeSignals(rising(22)));
    const long = scoreSignals(computeSignals(rising(90)));
    expect(short.confidence).toBeLessThan(long.confidence);
  });

  it("orders drivers by how much they actually moved the score", () => {
    const out = scoreSignals(computeSignals(rising(80)));
    const magnitudes = out.drivers.map((d) => Math.abs(d.contribution));
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
  });

  it("produces no drivers and no direction when there is nothing to measure", () => {
    const empty: TechnicalSignals = computeSignals([]);
    const out = scoreSignals(empty);
    expect(out.drivers).toEqual([]);
    expect(out.direction).toBe("flat");
    expect(out.confidence).toBe(0);
  });
});

describe("combineOutlook", () => {
  const technical = scoreSignals(computeSignals(rising(80)));

  it("leaves the technical verdict untouched when there is no news", () => {
    // Brak newsów nie może być czytany jako neutralny wydźwięk ciągnący
    // wynik do zera — to byłaby kara za ciszę medialną.
    const out = combineOutlook(technical, null, 0);
    expect(out.score).toBe(technical.score);
    expect(out.confidence).toBe(technical.confidence);
  });

  it("ignores a sentiment score backed by zero items", () => {
    expect(combineOutlook(technical, 80, 0).score).toBe(technical.score);
  });

  it("weights price over headlines", () => {
    const withNews = combineOutlook(technical, -100, 5);
    // Bardzo negatywne newsy przesuwają wynik, ale go nie odwracają przy
    // mocnej technice — waga 75/25.
    expect(withNews.score).toBeLessThan(technical.score);
    expect(withNews.score).toBeGreaterThan(-technical.score);
  });

  it("raises confidence when news agrees and lowers it when it contradicts", () => {
    const agree = combineOutlook(technical, 60, 4);
    const clash = combineOutlook(technical, -60, 4);
    expect(agree.confidence).toBeGreaterThan(clash.confidence);
  });

  it("caps confidence on a flat verdict", () => {
    const flat = scoreSignals(computeSignals(series(Array(80).fill(100))));
    expect(combineOutlook(flat, 5, 3).confidence).toBeLessThanOrEqual(40);
  });
});
