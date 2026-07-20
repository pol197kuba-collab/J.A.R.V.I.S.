// Real ADS-B aircraft within a map viewport, driven by the map's own
// bounds (Leaflet's getBounds()) rather than a fixed radius around the
// user — panning/zooming the map like a real flight tracker actually loads
// aircraft wherever you're looking, not just near "home".
//
// Data source: adsb.lol's free, keyless community API. Previously OpenSky
// Network — dropped after its API started returning persistent HTTP 522
// to the deployed server's egress (Cloudflare edge unable to reach
// OpenSky's origin — both sides sit behind Cloudflare) while the very same
// endpoint answered 200 in ~0.5s from an ordinary host. Nothing on our
// side (timeouts, retries) could fix a failure between their CDN and their
// origin, so the provider had to change. adsb.lol serves the same ADS-B
// state data with richer per-aircraft fields (registration, airframe type)
// and no hard daily quota.

export type Bounds = { lamin: number; lomin: number; lamax: number; lomax: number };

export type Aircraft = {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number;
  altitudeM: number;
  speedKmh: number | null;
  callsign: string;
  registration: string | null;
  typeCode: string | null;
};

export type FlightQueryResult =
  { ok: true; aircraft: Aircraft[] } | { ok: false; reason: "area_too_large" };

// adsb.lol queries are point + radius (max 250 nautical miles), not a
// bounding box — the viewport is covered by querying the circle that
// circumscribes it and filtering the result back down to the box. 250nm
// circumscribes roughly an 8°-span viewport at mid-latitudes, so beyond
// that span the map refuses to fetch (the UI shows "zoom in to load")
// rather than silently showing only the center of the view.
export const MAX_QUERY_SPAN_DEG = 8;
const MAX_RADIUS_NM = 250;

// Relevant subset of adsb.lol's per-aircraft object (readsb JSON shape).
// Verified field-by-field against a live response before writing this:
// altitudes in feet (alt_baro is the literal string "ground" when parked),
// ground speed `gs` in knots, `track` in degrees clockwise from north,
// `r` = registration, `t` = airframe type code. Position can be absent on
// mlat/tisb-only contacts.
type AdsbAircraft = {
  hex: string;
  flight?: string | null;
  r?: string | null;
  t?: string | null;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground" | null;
  alt_geom?: number | null;
  gs?: number | null;
  track?: number | null;
  true_heading?: number | null;
};

const FT_TO_M = 0.3048;
const KNOTS_TO_KMH = 1.852;
const KM_PER_NM = 1.852;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchFlightsInBounds(bounds: Bounds): Promise<FlightQueryResult> {
  const latSpan = bounds.lamax - bounds.lamin;
  const lonSpan = bounds.lomax - bounds.lomin;
  if (latSpan > MAX_QUERY_SPAN_DEG || lonSpan > MAX_QUERY_SPAN_DEG) {
    return { ok: false, reason: "area_too_large" };
  }

  const clat = (bounds.lamin + bounds.lamax) / 2;
  // Leaflet can report longitudes beyond ±180 after panning across the
  // dateline; the API wants a normalized one.
  const clon = ((((bounds.lomin + bounds.lomax) / 2 + 540) % 360) + 360) % 360 - 180;
  const cornerKm = haversineKm(clat, clon, bounds.lamax, bounds.lomax);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.max(10, Math.ceil(cornerKm / KM_PER_NM)));

  // 10s wasn't enough in production back on OpenSky and was aborting every
  // poll — the deployed server's network egress is evidently much slower
  // than an ordinary host's, so the generous timeout stays with the new
  // provider too.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  const res = await fetch(`https://api.adsb.lol/v2/point/${clat}/${clon}/${radiusNm}`, {
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`adsb_http_${res.status}`);
  const data = (await res.json()) as { ac: AdsbAircraft[] | null };
  const contacts = data.ac ?? [];

  const aircraft = contacts
    .filter(
      (a) =>
        typeof a.lat === "number" &&
        typeof a.lon === "number" &&
        a.alt_baro !== "ground" &&
        // The query circle circumscribes the viewport — trim back to it.
        a.lat >= bounds.lamin &&
        a.lat <= bounds.lamax &&
        a.lon >= bounds.lomin &&
        a.lon <= bounds.lomax,
    )
    .map((a): Aircraft => {
      const altFt = a.alt_geom ?? (typeof a.alt_baro === "number" ? a.alt_baro : null);
      return {
        id: a.hex,
        lat: a.lat as number,
        lon: a.lon as number,
        headingDeg: a.track ?? a.true_heading ?? 0,
        altitudeM: Math.round((altFt ?? 0) * FT_TO_M),
        speedKmh: a.gs != null ? Math.round(a.gs * KNOTS_TO_KMH) : null,
        callsign: (a.flight ?? "").trim() || (a.r ?? "").trim() || a.hex.toUpperCase(),
        registration: a.r?.trim() || null,
        typeCode: a.t?.trim() || null,
      };
    })
    // Caps render/marker count for performance on a busy viewport (a big
    // European view can easily have 500+ aircraft airborne at once).
    .slice(0, 150);

  return { ok: true, aircraft };
}
