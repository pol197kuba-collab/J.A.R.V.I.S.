// Real ADS-B aircraft within a map viewport, via OpenSky Network's free,
// keyless "all state vectors" endpoint. Driven by the map's own bounds
// (Leaflet's getBounds()) rather than a fixed radius around the user —
// panning/zooming the map like a real flight tracker actually loads
// aircraft wherever you're looking, not just near "home".

export type Bounds = { lamin: number; lomin: number; lamax: number; lomax: number };

export type Aircraft = {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number;
  altitudeM: number;
  speedKmh: number | null;
  callsign: string;
  originCountry: string;
};

export type FlightQueryResult =
  { ok: true; aircraft: Aircraft[] } | { ok: false; reason: "area_too_large" };

// OpenSky's anonymous tier is capped at 400 requests/day, and bills larger
// bounding boxes more heavily against that budget — a whole-world query
// (the extreme case a user reaches by zooming all the way out) would burn
// through a meaningful chunk of it in a single call. Cap the queryable
// span and refuse to fetch beyond it rather than ever sending one.
export const MAX_QUERY_SPAN_DEG = 15;

// OpenSky returns each aircraft as a positional array, not an object —
// index meanings per https://openskynetwork.github.io/opensky-api/rest.html
// Verified field-by-field against a live response before writing this.
type OpenSkyState = [
  string, // 0 icao24
  string | null, // 1 callsign
  string, // 2 origin_country
  number | null, // 3 time_position
  number, // 4 last_contact
  number | null, // 5 longitude
  number | null, // 6 latitude
  number | null, // 7 baro_altitude (m)
  boolean, // 8 on_ground
  number | null, // 9 velocity (m/s)
  number | null, // 10 true_track (deg, 0 = north)
  number | null, // 11 vertical_rate
  number[] | null, // 12 sensors
  number | null, // 13 geo_altitude (m)
  string | null, // 14 squawk
  boolean, // 15 spi
  number, // 16 position_source
];

export async function fetchFlightsInBounds(bounds: Bounds): Promise<FlightQueryResult> {
  const latSpan = bounds.lamax - bounds.lamin;
  const lonSpan = bounds.lomax - bounds.lomin;
  if (latSpan > MAX_QUERY_SPAN_DEG || lonSpan > MAX_QUERY_SPAN_DEG) {
    return { ok: false, reason: "area_too_large" };
  }

  const params = new URLSearchParams({
    lamin: String(bounds.lamin),
    lomin: String(bounds.lomin),
    lamax: String(bounds.lamax),
    lomax: String(bounds.lomax),
  });
  // 10s wasn't enough in production and was aborting every single poll
  // (confirmed via the system_events error this timeout itself logs) even
  // though a direct request to OpenSky from an ordinary host responds in
  // under 2s — the deployed server's network path to OpenSky is evidently
  // much slower than that (e.g. Cloudflare Workers' egress), not OpenSky
  // itself being slow.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  const res = await fetch(`https://opensky-network.org/api/states/all?${params}`, {
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`opensky_http_${res.status}`);
  const data = (await res.json()) as { states: OpenSkyState[] | null };
  const states = data.states ?? [];

  const aircraft = states
    .filter((s) => !s[8] && s[5] != null && s[6] != null) // airborne, has a position
    .map((s): Aircraft => {
      const [
        icao24,
        callsignRaw,
        originCountry,
        ,
        ,
        flon,
        flat,
        baroAlt,
        ,
        velocity,
        trueTrack,
        ,
        ,
        geoAlt,
      ] = s;
      return {
        id: icao24,
        lat: flat as number,
        lon: flon as number,
        headingDeg: trueTrack ?? 0,
        altitudeM: geoAlt ?? baroAlt ?? 0,
        speedKmh: velocity != null ? Math.round(velocity * 3.6) : null,
        callsign: (callsignRaw ?? "").trim() || icao24.toUpperCase(),
        originCountry,
      };
    })
    // Caps render/marker count for performance on a busy viewport (a big
    // European view can easily have 500+ aircraft airborne at once).
    .slice(0, 150);

  return { ok: true, aircraft };
}
