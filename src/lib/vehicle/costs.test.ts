import { describe, expect, it } from "vitest";
import { priceOnOrBefore, pumpEstimate, vehicleStats, type Reading } from "./costs";

const r = (
  id: string,
  loggedOn: string,
  km: number,
  l: number | null,
  pln: number | null,
): Reading => ({
  id,
  loggedOn,
  odometerKm: km,
  fuelLiters: l,
  amountPln: pln,
});

describe("pumpEstimate", () => {
  it("adds the station margin and VAT to Orlen's wholesale price", () => {
    // 5000 zł/m³ → 5,00 zł/l net + 0,20 margin → ×1,23 = 6,40
    expect(pumpEstimate(5000)).toBe(6.4);
  });
});

describe("priceOnOrBefore", () => {
  const p = priceOnOrBefore([
    { date: "2026-10-01", price: 5000 },
    { date: "2026-10-03", price: 5100 },
  ]);
  it("takes the last published price, never a later one", () => {
    expect(p("2026-09-30")).toBeNull();
    expect(p("2026-10-02")).toBe(5000);
    expect(p("2026-10-03")).toBe(5100);
    expect(p("2026-12-01")).toBe(5100);
  });
});

describe("vehicleStats", () => {
  const price = () => 5000; // → 6,40 zł/l at the pump
  it("full-to-full: each fill pays for the km since the previous reading", () => {
    const s = vehicleStats(
      [
        r("a", "2026-10-01", 100_000, 40, 260), // first reading: no segment
        r("b", "2026-10-08", 100_600, 36, 234),
        r("c", "2026-10-15", 101_200, 39, null), // estimated: 39 × 6,40 = 249,60
      ],
      price,
    );
    expect(s.distanceKm).toBe(1200);
    expect(s.segments.map((x) => [x.km, x.cost, x.costSource])).toEqual([
      [600, 234, "paid"],
      [600, 249.6, "estimate"],
    ]);
    expect(s.fuelCost).toBe(483.6);
    expect(s.costPerKm).toBeCloseTo(0.403, 3);
    expect(s.litersPer100).toBeCloseTo(6.25, 2);
    expect(s.estimatedShare).toBeCloseTo(249.6 / 483.6, 4);
    expect(s.lastKm).toBe(101_200);
  });

  it("a bare km reading adds distance but doesn't cut the fill-up's stretch", () => {
    const s = vehicleStats(
      [
        r("c", "2026-10-20", 101_000, 35, 230),
        r("x", "2026-10-12", 100_700, null, null),
        r("a", "2026-10-01", 100_000, 40, 260),
        r("z", "2026-10-25", 101_300, null, null),
      ],
      price,
    );
    expect(s.segments.map((x) => [x.reading.id, x.km, x.cost])).toEqual([["c", 1000, 230]]);
    expect(s.costPerKm).toBeCloseTo(0.23, 3);
    expect(s.litersPer100).toBeCloseTo(3.5, 2);
    expect(s.distanceKm).toBe(1300);
    expect(s.lastKm).toBe(101_300);
  });

  it("nothing to say with fewer than two readings or no prices", () => {
    expect(vehicleStats([r("a", "2026-10-01", 1, 10, null)], price).costPerKm).toBeNull();
    const s = vehicleStats(
      [r("a", "2026-10-01", 0, 10, null), r("b", "2026-10-02", 500, 30, null)],
      () => null,
    );
    expect(s.costPerKm).toBeNull();
    expect(s.litersPer100).toBe(6);
  });
});
