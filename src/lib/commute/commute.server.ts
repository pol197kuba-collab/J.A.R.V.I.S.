// DOJAZD — odczyt ustawień i klucza z bazy, złożenie wyniku. Wspólne dla
// server functions (strona, kafelek, dock), briefingu i joba alertów.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { planDeparture } from "./plan";
import { buildCommute, fetchRoutes } from "./tomtom.server";
import {
  DEFAULT_COMMUTE_SETTINGS,
  type CommuteDirection,
  type CommuteResult,
  type CommuteRoute,
  type CommuteSettings,
  type LatLon,
  type SavedRoute,
  type ViaPoint,
} from "./types";

type Db = SupabaseClient<Database>;

type Row = Database["public"]["Tables"]["commute_settings"]["Row"];

const point = (lat: number | null, lon: number | null, label: string | null) =>
  lat === null || lon === null ? null : { lat: Number(lat), lon: Number(lon), label: label ?? "" };

export function settingsFromRow(row: Row | null): CommuteSettings {
  if (!row) return DEFAULT_COMMUTE_SETTINGS;
  return {
    home: point(row.home_lat, row.home_lon, row.home_label),
    work: point(row.work_lat, row.work_lon, row.work_label),
    departToMin: row.depart_to_min,
    departBackMin: row.depart_back_min,
    arriveByMin: row.arrive_by_min,
    alertEnabled: row.alert_enabled,
    alertDelayMin: row.alert_delay_min,
  };
}

export async function loadCommuteSettings(db: Db, ownerId: string): Promise<CommuteSettings> {
  const { data, error } = await db
    .from("commute_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return settingsFromRow(data);
}

/** Klucz TomTom z Ustawień; w jobie bez konta awaryjnie ze zmiennej środowiska. */
export async function loadTomtomKey(db: Db, ownerId: string): Promise<string | null> {
  const { data } = await db
    .from("user_secrets")
    .select("tomtom_api_key")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data?.tomtom_api_key?.trim() || process.env.TOMTOM_API_KEY?.trim() || null;
}

type RouteRow = Database["public"]["Tables"]["commute_routes"]["Row"];

function viaFromJson(value: unknown): ViaPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): ViaPoint[] => {
    const p = v as { lat?: unknown; lon?: unknown; label?: unknown };
    return typeof p?.lat === "number" && typeof p?.lon === "number"
      ? [{ lat: p.lat, lon: p.lon, ...(typeof p.label === "string" ? { label: p.label } : {}) }]
      : [];
  });
}

export const savedFromRow = (row: RouteRow): SavedRoute => ({
  id: row.id,
  direction: row.direction === "back" ? "back" : "to",
  name: row.name,
  via: viaFromJson(row.via),
  isDefault: row.is_default,
});

export async function loadSavedRoutes(
  db: Db,
  ownerId: string,
  direction?: CommuteDirection,
): Promise<SavedRoute[]> {
  let q = db.from("commute_routes").select("*").eq("owner_id", ownerId);
  if (direction) q = q.eq("direction", direction);
  const { data, error } = await q.order("position").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map(savedFromRow);
}

export type CommuteOutcome =
  | { ok: true; result: CommuteResult }
  | { ok: false; reason: "no_key" | "no_places" };

/** Dojazd w danym kierunku dla zaplanowanej (lub bieżącej) godziny wyjazdu. */
export async function computeCommute(
  db: Db,
  ownerId: string,
  direction: CommuteDirection,
  now: Date = new Date(),
  settingsIn?: CommuteSettings,
): Promise<CommuteOutcome> {
  const settings = settingsIn ?? (await loadCommuteSettings(db, ownerId));
  if (!settings.home || !settings.work) return { ok: false, reason: "no_places" };
  const key = await loadTomtomKey(db, ownerId);
  if (!key) return { ok: false, reason: "no_key" };

  const plan = planDeparture(
    now,
    direction === "to" ? settings.departToMin : settings.departBackMin,
  );
  const [origin, destination] =
    direction === "to" ? [settings.home, settings.work] : [settings.work, settings.home];
  // Brak tabeli tras (migracja jeszcze nie wgrana) nie może zabić dojazdu —
  // wtedy liczymy jak dawniej, z samych tras automatycznych.
  const saved = await loadSavedRoutes(db, ownerId, direction).catch(() => []);
  return {
    ok: true,
    result: await buildCommute(key, direction, origin, destination, plan, saved),
  };
}

/** Podgląd trasy z punktami pośrednimi (edytor): sama trasa, bez utrudnień. */
export async function previewRoute(
  db: Db,
  ownerId: string,
  direction: CommuteDirection,
  via: readonly LatLon[],
  now: Date = new Date(),
): Promise<CommuteRoute | null> {
  const settings = await loadCommuteSettings(db, ownerId);
  if (!settings.home || !settings.work) return null;
  const key = await loadTomtomKey(db, ownerId);
  if (!key) return null;
  const plan = planDeparture(
    now,
    direction === "to" ? settings.departToMin : settings.departBackMin,
  );
  const [origin, destination] =
    direction === "to" ? [settings.home, settings.work] : [settings.work, settings.home];
  const [route] = await fetchRoutes(key, origin, destination, plan, { via });
  return route ?? null;
}
