// Real ADS-B aircraft within a map viewport, driven by the map's own
// bounds (Leaflet's getBounds()) rather than a fixed radius around the
// user — panning/zooming the map like a real flight tracker actually loads
// aircraft wherever you're looking, not just near "home".
//
// Data source: free, keyless community ADS-B mirrors (readsb-derived JSON
// API, `{ac: [...]}` shape). Originally OpenSky Network — dropped after
// its API started returning persistent HTTP 522 to the deployed server's
// egress while the same endpoint answered 200 in ~0.5s from an ordinary
// host (a Cloudflare-edge-to-OpenSky-origin path issue, not fixable from
// our side). Replaced with adsb.lol, which then started returning
// persistent HTTP 429 in production while the same endpoint, hit
// repeatedly from an ordinary host, never rate-limited at all — adsb.lol
// documents its limits as "dynamic based on environment load", and the
// deployed server's egress (Cloudflare Workers) shares its IP pool with
// many other tenants, so our own request rate isn't necessarily the
// trigger. Rather than chase a third single point of failure, this now
// tries two independent free mirrors (adsb.lol, then airplanes.live) and
// uses whichever answers — the same automatic-failover shape already used
// for the Gemini/Groq AI routing in this codebase.

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

// Both mirrors are point + radius (max 250 nautical miles), not a
// bounding box — the viewport is covered by querying the circle that
// circumscribes it and filtering the result back down to the box. 250nm
// circumscribes roughly an 8°-span viewport at mid-latitudes, so beyond
// that span the map refuses to fetch (the UI shows "zoom in to load")
// rather than silently showing only the center of the view.
export const MAX_QUERY_SPAN_DEG = 8;
const MAX_RADIUS_NM = 250;

// Tried in order per request; each is a fully independent free deployment
// (different maintainers, different infra), so one being rate-limited or
// down doesn't take the other with it. Confirmed live to share the exact
// same response shape (both are readsb-derived JSON APIs).
const PROVIDERS = ["https://api.adsb.lol/v2/point", "https://api.airplanes.live/v2/point"];

// Relevant subset of the shared readsb-derived per-aircraft object.
// Verified field-by-field against live responses from both providers
// before writing this: altitudes in feet (alt_baro is the literal string
// "ground" when parked), ground speed `gs` in knots, `track` in degrees
// clockwise from north, `r` = registration, `t` = airframe type code.
// Position can be absent on mlat/tisb-only contacts.
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

async function fetchFromProvider(baseUrl: string, clat: number, clon: number, radiusNm: number) {
  // 10s wasn't enough in production back on OpenSky and was aborting
  // every poll — the deployed server's network egress is evidently much
  // slower than an ordinary host's, so the generous timeout stays here
  // for every provider.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${baseUrl}/${clat}/${clon}/${radiusNm}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = (await res.json()) as { ac: AdsbAircraft[] | null };
    return data.ac ?? [];
  } finally {
    clearTimeout(timer);
  }
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

  let contacts: AdsbAircraft[] | null = null;
  let lastErr: unknown;
  for (const provider of PROVIDERS) {
    try {
      contacts = await fetchFromProvider(provider, clat, clon, radiusNm);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (contacts === null) {
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

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
