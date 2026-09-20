import { describe, expect, it } from "vitest";
import {
  bestLagCorrelation,
  computeStats,
  dailyChangeGrid,
  forecastNext,
  indexTo100,
  linearRegression,
  movingAverage,
  pearson,
  type PricePoint,
} from "./analytics";

function seriesFrom(start: string, prices: number[]): PricePoint[] {
  const out: PricePoint[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (const price of prices) {
    out.push({ date: d.toISOString().slice(0, 10), price });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("computeStats", () => {
  it("liczy deltę dzienną, tygodniową i miesięczną", () => {
    const points = seriesFrom(
      "2026-08-01",
      Array.from({ length: 40 }, (_, i) => 7000 + i * 10),
    );
    const stats = computeStats(points);
    expect(stats.latest).toBe(7390);
    expect(stats.latestDate).toBe("2026-09-09");
    expect(stats.changeDay).toBe(10);
    expect(stats.changeWeek).toBe(70);
    expect(stats.changeMonth).toBe(300);
    expect(stats.changeDayPct).toBeCloseTo(0.14, 1);
  });

  it("ustawia pozycję w paśmie 52-tygodniowym", () => {
    expect(computeStats(seriesFrom("2026-09-01", [100, 200, 300])).position52w).toBe(100);
    expect(computeStats(seriesFrom("2026-09-01", [300, 200, 100])).position52w).toBe(0);
    expect(computeStats(seriesFrom("2026-09-01", [100, 300, 200])).position52w).toBe(50);
  });

  it("zwraca same null-e dla pustej serii", () => {
    const stats = computeStats([]);
    expect(stats.latest).toBeNull();
    expect(stats.changeDay).toBeNull();
    expect(stats.position52w).toBeNull();
  });

  it("nie wywraca się na serii krótszej niż okna porównawcze", () => {
    const stats = computeStats(seriesFrom("2026-09-18", [7000, 7100]));
    expect(stats.changeDay).toBe(100);
    expect(stats.changeWeek).toBeNull();
    expect(stats.changeMonth).toBeNull();
  });
});

describe("movingAverage", () => {
  it("zwraca null zanim okno się zapełni", () => {
    expect(movingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });
});

describe("pearson", () => {
  it("daje 1 dla idealnej zgodności i -1 dla odwrotnej", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBe(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBe(-1);
  });

  it("daje 0 dla serii bez zmienności albo za krótkiej", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
    expect(pearson([1], [1])).toBe(0);
  });
});

describe("bestLagCorrelation", () => {
  it("znajduje opóźnienie, z jakim cennik podąża za ropą", () => {
    // Driver = szum sinusoidalny; target = ten sam przebieg opóźniony o 4 dni.
    const driver = Array.from({ length: 80 }, (_, i) => 2000 + Math.sin(i / 3) * 100);
    const lag = 4;
    const target = Array.from({ length: 80 }, (_, i) => driver[Math.max(0, i - lag)] + 5000);

    const result = bestLagCorrelation(target, driver, 10);
    expect(result.lagDays).toBe(lag);
    expect(result.r).toBeGreaterThan(0.95);
  });

  it("zwraca zerową korelację dla serii za krótkiej na wnioskowanie", () => {
    expect(bestLagCorrelation([1, 2, 3], [1, 2, 3])).toEqual({ lagDays: 0, r: 0 });
  });
});

describe("linearRegression", () => {
  it("odtwarza nachylenie idealnej prostej", () => {
    const { slope, intercept } = linearRegression([10, 20, 30, 40]);
    expect(slope).toBeCloseTo(10, 6);
    expect(intercept).toBeCloseTo(10, 6);
  });
});

describe("forecastNext", () => {
  it("wykrywa trend wzrostowy i rozszerza wstęgę z horyzontem", () => {
    const points = seriesFrom(
      "2026-08-15",
      Array.from({ length: 30 }, (_, i) => 7000 + i * 12 + (i % 2 ? 3 : -3)),
    );
    const forecast = forecastNext(points, 5);

    expect(forecast.direction).toBe("up");
    expect(forecast.slopePerDay).toBeGreaterThan(10);
    expect(forecast.points).toHaveLength(5);
    expect(forecast.points[0].date).toBe("2026-09-14");
    expect(forecast.points[4].value).toBeGreaterThan(forecast.points[0].value);

    const firstBand = forecast.points[0].upper - forecast.points[0].lower;
    const lastBand = forecast.points[4].upper - forecast.points[4].lower;
    expect(lastBand).toBeGreaterThan(firstBand);
  });

  it("mówi 'flat', gdy nachylenie tonie w szumie", () => {
    const points = seriesFrom(
      "2026-08-15",
      Array.from({ length: 30 }, (_, i) => 7000 + (i % 3) * 40 - 40),
    );
    expect(forecastNext(points).direction).toBe("flat");
  });

  it("wykrywa trend spadkowy", () => {
    const points = seriesFrom(
      "2026-08-15",
      Array.from({ length: 30 }, (_, i) => 7500 - i * 15),
    );
    expect(forecastNext(points).direction).toBe("down");
  });

  it("nie prognozuje z serii krótszej niż 5 punktów", () => {
    const forecast = forecastNext(seriesFrom("2026-09-15", [7000, 7100]));
    expect(forecast.points).toEqual([]);
    expect(forecast.confidence).toBe(0);
  });
});

describe("dailyChangeGrid", () => {
  it("mapuje zmiany dzienne na siatkę tygodni i dni", () => {
    const cells = dailyChangeGrid(seriesFrom("2026-09-14", [7000, 7050, 7020]), 2);
    const byDate = new Map(cells.map((c) => [c.date, c.change]));

    expect(byDate.get("2026-09-14")).toBeNull(); // pierwszy punkt nie ma z czym porównać
    expect(byDate.get("2026-09-15")).toBe(50);
    expect(byDate.get("2026-09-16")).toBe(-30);
    // 2026-09-14 to poniedziałek — musi wylądować w pierwszym wierszu siatki.
    expect(cells.find((c) => c.date === "2026-09-14")?.dayIndex).toBe(0);
  });

  it("zwraca pustą siatkę dla pustej serii", () => {
    expect(dailyChangeGrid([])).toEqual([]);
  });
});

describe("indexTo100", () => {
  it("normalizuje serię do 100 w punkcie startowym", () => {
    expect(indexTo100([200, 220, 180])).toEqual([100, 110, 90]);
  });
});
