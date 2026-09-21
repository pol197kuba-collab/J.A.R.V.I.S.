import { describe, expect, it } from "vitest";
import { projectForecast } from "./projection";
import type { PricePoint } from "./series";

/** Seria o zadanej skali dziennych ruchów.
 *
 *  Ruchy MUSZĄ się różnić między sobą: przy idealnie równym tempie wzrostu
 *  odchylenie zwrotów wynosi zero, więc zmienność też — i test mierzyłby
 *  wtedy zachowanie ścieżki zapasowej zamiast tego, co chce mierzyć. */
const series = (count: number, start: number, dailyPct: number): PricePoint[] => {
  const out: PricePoint[] = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(2026, 5, 1));
    d.setUTCDate(d.getUTCDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), close: price });
    // Deterministyczny szum wokół zadanego tempa — powtarzalny między
    // przebiegami, a mimo to daje niezerowe odchylenie zwrotów.
    const wobble = Math.sin(i * 1.7) * dailyPct * 0.6;
    price *= 1 + (dailyPct + wobble) / 100;
  }
  return out;
};

const FLAT = series(80, 100, 0);

describe("projectForecast", () => {
  it("projects upward for a bullish call and downward for a bearish one", () => {
    const points = series(80, 100, 0.3);
    const up = projectForecast(points, { score: 60, direction: "up", confidence: 70 }, 7);
    const down = projectForecast(points, { score: -60, direction: "down", confidence: 70 }, 7);
    const last = points[points.length - 1].close;

    expect(up).toHaveLength(7);
    expect(up[up.length - 1].mid).toBeGreaterThan(last);
    expect(down[down.length - 1].mid).toBeLessThan(last);
  });

  it("draws nothing when the outlook has no opinion", () => {
    // „Flat" to nie jest prognoza „bez zmian" — to brak zdania. Płaska kreska
    // w przyszłość mówiłaby użytkownikowi coś, czego typer nie powiedział.
    expect(projectForecast(FLAT, { score: 3, direction: "flat", confidence: 40 }, 7)).toEqual([]);
  });

  it("draws nothing without any history to stand on", () => {
    expect(projectForecast([], { score: 60, direction: "up", confidence: 70 }, 7)).toEqual([]);
  });

  it("scales the move by the instrument's own volatility, not by the score alone", () => {
    // To jest sedno: ten sam wynik typera na spokojnym i na rozchwianym
    // instrumencie musi dać różny ruch w procentach. Inaczej strzałka na
    // parze walutowej wyglądałaby jak na krypto.
    const calm = series(80, 100, 0.05);
    const wild = series(80, 100, 2);
    const call = { score: 80, direction: "up" as const, confidence: 60 };

    const calmMove = projectForecast(calm, call, 7).at(-1)!.mid / calm.at(-1)!.close - 1;
    const wildMove = projectForecast(wild, call, 7).at(-1)!.mid / wild.at(-1)!.close - 1;
    expect(wildMove).toBeGreaterThan(calmMove * 2);
  });

  it("keeps even an extreme call inside a sane bound", () => {
    // Zmienność potrafi wystrzelić po jednej gwałtownej sesji. Prognoza
    // „+80% w tydzień" nie jest prognozą, tylko usterką wykresu.
    const violent = series(80, 100, 9);
    const path = projectForecast(violent, { score: 100, direction: "up", confidence: 90 }, 7);
    const movePct = (path.at(-1)!.mid / violent.at(-1)!.close - 1) * 100;
    expect(movePct).toBeLessThanOrEqual(25.0001);
  });

  it("widens the band when the outlook is less sure", () => {
    const points = series(80, 100, 0.3);
    const width = (confidence: number) => {
      const p = projectForecast(points, { score: 50, direction: "up", confidence }, 7).at(-1)!;
      return p.high - p.low;
    };
    expect(width(10)).toBeGreaterThan(width(90));
  });

  it("widens the band with distance, so tomorrow is tighter than next week", () => {
    const path = projectForecast(
      series(80, 100, 0.3),
      { score: 50, direction: "up", confidence: 50 },
      7,
    );
    const first = path[0].high - path[0].low;
    const last = path[path.length - 1].high - path[path.length - 1].low;
    expect(last).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(0);
  });

  it("starts the day after the last quote and runs the full horizon", () => {
    const points = series(30, 100, 0.2);
    const path = projectForecast(points, { score: 40, direction: "up", confidence: 50 }, 7);
    const lastDate = points[points.length - 1].date;
    expect(path).toHaveLength(7);
    expect(path[0].date > lastDate).toBe(true);
    expect(path.map((p) => p.date)).toEqual([...path.map((p) => p.date)].sort());
  });

  it("survives a flat series with no computable volatility", () => {
    // Zero zmienności → zapasowa wartość, a nie NaN na wykresie.
    const path = projectForecast(FLAT, { score: 50, direction: "up", confidence: 50 }, 7);
    expect(path).toHaveLength(7);
    for (const p of path) {
      expect(Number.isFinite(p.mid)).toBe(true);
      expect(Number.isFinite(p.low)).toBe(true);
      expect(Number.isFinite(p.high)).toBe(true);
    }
  });
});
