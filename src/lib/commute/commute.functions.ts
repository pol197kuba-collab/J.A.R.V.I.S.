// DOJAZD — server functions dla interfejsu: ustawienia, wyszukiwanie adresów
// i sam wynik. Klucz TomTom zostaje na serwerze; przeglądarka dostaje wyniki.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import {
  computeCommute,
  loadCommuteSettings,
  loadSavedRoutes,
  loadTomtomKey,
  previewRoute,
} from "./commute.server";
import { geocode, type GeocodeHit } from "./tomtom.server";
import {
  MAX_SAVED_ROUTES,
  MAX_VIA_POINTS,
  type CommuteResult,
  type CommuteRoute,
  type CommuteSettings,
  type SavedRoute,
} from "./types";

export type CommuteResponse =
  | { status: "ok"; result: CommuteResult; settings: CommuteSettings; saved: SavedRoute[] }
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
      if (!outcome.ok) return { status: outcome.reason, settings };
      const saved = await loadSavedRoutes(supabase, userId, data.direction).catch(() => []);
      return { status: "ok", result: outcome.result, settings, saved };
    } catch (err) {
      // Ślad w System Logs — klient i tak dostaje tylko ogólny błąd.
      await logServerError(supabase, userId, "commute.fetch", err);
      throw err;
    }
  });

/**
 * Klucz do kafelków mapy.
 *
 * ŚWIADOMY WYJĄTEK od zasady „klucz zostaje na serwerze": kafelki ładuje
 * przeglądarka (<img>), która nie wyśle nagłówka autoryzacji do pośrednika, a
 * każdy kafelek przez serwer kosztowałby osobne wywołanie funkcji. Klucz jest
 * własnością zalogowanego właściciela i wraca tylko do niego. W panelu TomTom
 * można go dodatkowo zawęzić do domeny aplikacji (Allowed referrers).
 */
export const getMapTileKeyFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ key: string | null }> => {
    const { supabase, userId } = context;
    return { key: await loadTomtomKey(supabase, userId) };
  });

// ---------------------------------------------------------------------------
// Moje trasy (zapisane warianty z punktami pośrednimi)
// ---------------------------------------------------------------------------

const Direction = z.enum(["to", "back"]);
const Via = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().trim().max(120).optional(),
});

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const cleanVia = (via: Array<z.infer<typeof Via>>) =>
  via.map((v) => ({ lat: r6(v.lat), lon: r6(v.lon), ...(v.label ? { label: v.label } : {}) }));

const SaveRouteInput = z.object({
  id: z.string().uuid().optional(),
  direction: Direction,
  name: z.string().trim().min(1).max(60),
  via: z.array(Via).min(1).max(MAX_VIA_POINTS),
  makeDefault: z.boolean().optional(),
});

export const saveCommuteRouteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveRouteInput.parse(input))
  .handler(async ({ data, context }): Promise<SavedRoute[]> => {
    const { supabase, userId } = context;
    const existing = await loadSavedRoutes(supabase, userId, data.direction);
    if (!data.id && existing.length >= MAX_SAVED_ROUTES) {
      throw new Error(`Można zapisać najwyżej ${MAX_SAVED_ROUTES} trasy na kierunek.`);
    }
    const via = cleanVia(data.via);
    if (data.id) {
      const { error } = await supabase
        .from("commute_routes")
        .update({ name: data.name, via })
        .eq("id", data.id)
        .eq("owner_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabase
        .from("commute_routes")
        .insert({
          owner_id: userId,
          direction: data.direction,
          name: data.name,
          via,
          position: existing.length,
          // Pierwsza zapisana trasa kierunku od razu staje się domyślną — po to ją dodajesz.
          is_default: false,
        })
        .select("id")
        .single();
      if (error) {
        await logServerError(supabase, userId, "commute.route", error);
        throw new Error(error.message);
      }
      data.id = row.id;
      if (existing.length === 0) data.makeDefault = true;
    }
    if (data.makeDefault && data.id) await setDefault(supabase, userId, data.direction, data.id);
    return loadSavedRoutes(supabase, userId, data.direction);
  });

async function setDefault(
  supabase: Parameters<typeof loadSavedRoutes>[0],
  userId: string,
  direction: "to" | "back",
  id: string | null,
): Promise<void> {
  // Najpierw zdejmujemy gwiazdkę (unikalny indeks pilnuje jednej na kierunek),
  // potem nadajemy nową. Gdyby drugi krok padł, zostaje trasa automatyczna.
  const clear = await supabase
    .from("commute_routes")
    .update({ is_default: false })
    .eq("owner_id", userId)
    .eq("direction", direction)
    .eq("is_default", true);
  if (clear.error) throw new Error(clear.error.message);
  if (id === null) return;
  const set = await supabase
    .from("commute_routes")
    .update({ is_default: true })
    .eq("id", id)
    .eq("owner_id", userId)
    .eq("direction", direction);
  if (set.error) throw new Error(set.error.message);
}

/** `id: null` = trasą domyślną znów jest najszybsza automatyczna. */
export const setDefaultCommuteRouteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ direction: Direction, id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SavedRoute[]> => {
    const { supabase, userId } = context;
    await setDefault(supabase, userId, data.direction, data.id);
    return loadSavedRoutes(supabase, userId, data.direction);
  });

export const deleteCommuteRouteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("commute_routes")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) {
      await logServerError(supabase, userId, "commute.route", error);
      throw new Error(error.message);
    }
    return { ok: true };
  });

/** Podgląd trasy z punktami pośrednimi w edytorze: czas, dystans i linia do narysowania. */
export const previewCommuteRouteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ direction: Direction, via: z.array(Via).min(1).max(MAX_VIA_POINTS) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CommuteRoute | null> => {
    const { supabase, userId } = context;
    try {
      return await previewRoute(supabase, userId, data.direction, cleanVia(data.via));
    } catch (err) {
      await logServerError(supabase, userId, "commute.preview", err);
      throw err;
    }
  });
