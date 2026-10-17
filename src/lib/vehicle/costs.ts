// Vision AR (S4.2) — the car's real cost per kilometre, from odometer scans.
// Pure. Full-to-full: the fuel bought at a fill-up was burned over the km
// driven since the previous fill-up, so each fill-up after the first closes
// one segment. A segment's cost is what was paid at the pump; with no
// amount it's an estimate from Orlen's wholesale diesel price that day
// (+ station margin + VAT), and the result says how much was estimated.

/** Orlen productId for ON Ekodiesel (src/lib/fuel/orlen.ts). */
export const DIESEL_PRODUCT_ID = 43;
/** Typical station margin over Orlen's wholesale price, PLN/l net. */
export const STATION_MARGIN_NET = 0.2;
export const VAT = 0.23;

/** Wholesale PLN/m³ net (Orlen) → estimated pump price PLN/l gross. */
export const pumpEstimate = (wholesalePerM3: number) =>
  Math.round((wholesalePerM3 / 1000 + STATION_MARGIN_NET) * (1 + VAT) * 100) / 100;

export type Reading = {
  id: string;
  loggedOn: string; // YYYY-MM-DD
  odometerKm: number;
  fuelLiters: number | null;
  amountPln: number | null;
};

export type Segment = {
  reading: Reading;
  km: number;
  /** PLN for the fuel that covered this stretch, or null when unknown. */
  cost: number | null;
  costSource: "paid" | "estimate" | null;
  /** Estimated pump price used, PLN/l (only for estimates). */
  pricePerL: number | null;
};

export type VehicleStats = {
  segments: Segment[];
  distanceKm: number;
  /** Over segments with a known cost only. */
  costPerKm: number | null;
  litersPer100: number | null;
  fuelCost: number;
  estimatedShare: number; // 0..1 of fuelCost that is an estimate
  lastKm: number | null;
};

/**
 * @param wholesaleOn price lookup: Orlen ON wholesale PLN/m³ for a day (the
 *   latest published on or before it), or null when unknown.
 */
export function vehicleStats(
  readings: readonly Reading[],
  wholesaleOn: (day: string) => number | null,
): VehicleStats {
  const rs = [...readings].sort(
    (a, b) => a.odometerKm - b.odometerKm || a.loggedOn.localeCompare(b.loggedOn),
  );
  // Segments run fill-up to fill-up: a bare km reading (no litres, no
  // amount) didn't refuel anything, so it must not cut the stretch the
  // next fill-up pays for. It still counts toward the distance driven.
  const fills = rs.filter((r) => r.fuelLiters !== null || r.amountPln !== null);
  const segments: Segment[] = [];
  for (let i = 1; i < fills.length; i++) {
    const r = fills[i];
    const km = r.odometerKm - fills[i - 1].odometerKm;
    if (km <= 0) continue;
    let cost: number | null = null;
    let costSource: Segment["costSource"] = null;
    let pricePerL: number | null = null;
    if (r.amountPln !== null) {
      cost = r.amountPln;
      costSource = "paid";
    } else if (r.fuelLiters !== null) {
      const w = wholesaleOn(r.loggedOn);
      if (w !== null) {
        pricePerL = pumpEstimate(w);
        cost = Math.round(r.fuelLiters * pricePerL * 100) / 100;
        costSource = "estimate";
      }
    }
    segments.push({ reading: r, km, cost, costSource, pricePerL });
  }
  const costed = segments.filter((s) => s.cost !== null);
  const costKm = costed.reduce((s, x) => s + x.km, 0);
  const fuelCost = costed.reduce((s, x) => s + (x.cost ?? 0), 0);
  const estimated = costed
    .filter((s) => s.costSource === "estimate")
    .reduce((s, x) => s + (x.cost ?? 0), 0);
  const fueled = segments.filter((s) => s.reading.fuelLiters !== null);
  const fuelKm = fueled.reduce((s, x) => s + x.km, 0);
  const liters = fueled.reduce((s, x) => s + (x.reading.fuelLiters ?? 0), 0);
  return {
    segments,
    distanceKm: rs.length > 1 ? rs[rs.length - 1].odometerKm - rs[0].odometerKm : 0,
    costPerKm: costKm > 0 ? fuelCost / costKm : null,
    litersPer100: fuelKm > 0 ? (liters / fuelKm) * 100 : null,
    fuelCost: Math.round(fuelCost * 100) / 100,
    estimatedShare: fuelCost > 0 ? estimated / fuelCost : 0,
    lastKm: rs.length ? rs[rs.length - 1].odometerKm : null,
  };
}

/** Lookup over a price series (ascending by date): last price on or before a day. */
export function priceOnOrBefore(series: readonly { date: string; price: number }[]) {
  return (day: string): number | null => {
    let lo = 0,
      hi = series.length - 1,
      best: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].date <= day) {
        best = series[mid].price;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  };
}
