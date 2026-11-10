// DOJAZD — server functions dla interfejsu: ustawienia, wyszukiwanie adresów
// i sam wynik. Klucz TomTom zostaje na serwerze; przeglądarka dostaje wyniki.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import { computeCommute, loadCommuteSettings, loadTomtomKey } from "./commute.server";
import { geocode, type GeocodeHit } from "./tomtom.server";
import type { CommuteResult, CommuteSettings } from "./types";

export type CommuteResponse =
  | { status: "ok"; result: CommuteResult; settings: CommuteSettings }
  | { status: "no_key" | "no_places"; settings: CommuteSettings };

export const getCommuteSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommuteSettings & { tomtomLinked: boolean }> => {
    const { supabase, userId } = context;
    const [settings, key] = await Promise.all([
      loadCommuteSettings(supabase, userId),
      loadTomtomKey(supabase, userId),
    ]);
    return { ...settings, tomtomLinked: key !== null };
  });

const Place = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().trim().min(1).max(200),
});

const minuteOfDay = z.number().int().min(0).max(1439);

const SaveInput = z
  .object({
    home: Place.nullable().optional(),
    work: Place.nullable().optional(),
    departToMin: minuteOfDay.optional(),
    departBackMin: minuteOfDay.optional(),
    arriveByMin: minuteOfDay.nullable().optional(),
    alertEnabled: z.boolean().optional(),
    alertDelayMin: z.number().int().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

export type CommuteSettingsPatch = z.input<typeof SaveInput>;

export const saveCommuteSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }): Promise<CommuteSettings> => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = {
      owner_id: userId,
      updated_at: new Date().toISOString(),
    };
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    if (data.home !== undefined) {
      patch.home_lat = data.home ? r6(data.home.lat) : null;
      patch.home_lon = data.home ? r6(data.home.lon) : null;
      patch.home_label = data.home?.label ?? null;
    }
    if (data.work !== undefined) {
      patch.work_lat = data.work ? r6(data.work.lat) : null;
      patch.work_lon = data.work ? r6(data.work.lon) : null;
      patch.work_label = data.work?.label ?? null;
    }
    if (data.departToMin !== undefined) patch.depart_to_min = data.departToMin;
    if (data.departBackMin !== undefined) patch.depart_back_min = data.departBackMin;
    if (data.arriveByMin !== undefined) patch.arrive_by_min = data.arriveByMin;
    if (data.alertEnabled !== undefined) patch.alert_enabled = data.alertEnabled;
    if (data.alertDelayMin !== undefined) patch.alert_delay_min = data.alertDelayMin;

    const { error } = await supabase
      .from("commute_settings")
      .upsert(patch as never, { onConflict: "owner_id" });
    if (error) {
      await logServerError(supabase, userId, "commute.settings", error);
      throw new Error(error.message);
    }
    return loadCommuteSettings(supabase, userId);
  });

export const searchPlacesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(3).max(120) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<GeocodeHit[]> => {
    const { supabase, userId } = context;
    const key = await loadTomtomKey(supabase, userId);
    if (!key) throw new Error("Najpierw zapisz klucz TomTom w Ustawieniach → Klucze.");
    try {
      return await geocode(key, data.query);
    } catch (err) {
      await logServerError(supabase, userId, "commute.geocode", err);
      throw err;
    }
  });

export const getCommuteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ direction: z.enum(["to", "back"]) }).parse(input))
  .handler(async ({ data, context }): Promise<CommuteResponse> => {
    const { supabase, userId } = context;
    const settings = await loadCommuteSettings(supabase, userId);
    try {
      const outcome = await computeCommute(supabase, userId, data.direction, new Date(), settings);
      return outcome.ok
        ? { status: "ok", result: outcome.result, settings }
        : { status: outcome.reason, settings };
    } catch (err) {
      // Ślad w System Logs — klient i tak dostaje tylko ogólny błąd.
      await logServerError(supabase, userId, "commute.fetch", err);
      throw err;
    }
  });
