// Vision AR (S4.2) — the car's log for the cost-per-km panel on /paliwa.
// Readings come from confirmed odometer scans; diesel wholesale prices from
// the shared Orlen cache (orlen_fuel_prices) for estimates where the pump
// amount wasn't read.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DIESEL_PRODUCT_ID, type Reading } from "./costs";

export type VehicleView = {
  readings: (Reading & { note: string | null })[];
  /** Orlen ON wholesale PLN/m³, ascending by date. */
  diesel: { date: string; price: number }[];
};

export const getVehicleLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VehicleView> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("vehicle_log")
      .select("id, logged_on, odometer_km, fuel_liters, amount_pln, note")
      .eq("owner_id", userId)
      .order("odometer_km", { ascending: false })
      .limit(500);
    if (error) throw new Error(`Nie udało się wczytać dziennika auta: ${error.message}`);
    const readings = (rows ?? []).map((r) => ({
      id: r.id,
      loggedOn: r.logged_on,
      odometerKm: r.odometer_km,
      fuelLiters: r.fuel_liters === null ? null : Number(r.fuel_liters),
      amountPln: r.amount_pln === null ? null : Number(r.amount_pln),
      note: r.note,
    }));
    if (!readings.length) return { readings, diesel: [] };

    // A week before the first reading, so a Monday fill-up finds Friday's price.
    const first = readings.reduce(
      (m, r) => (r.loggedOn < m ? r.loggedOn : m),
      readings[0].loggedOn,
    );
    const from = new Date(`${first}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 7);
    const { data: prices } = await supabase
      .from("orlen_fuel_prices")
      .select("price_date, price_per_m3")
      .eq("product_id", DIESEL_PRODUCT_ID)
      .gte("price_date", from.toISOString().slice(0, 10))
      .order("price_date", { ascending: true })
      .limit(2000);
    return {
      readings,
      diesel: (prices ?? []).map((p) => ({ date: p.price_date, price: Number(p.price_per_m3) })),
    };
  });

export const deleteVehicleReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("vehicle_log")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) throw new Error(`Nie udało się usunąć odczytu: ${error.message}`);
    return { ok: true };
  });
