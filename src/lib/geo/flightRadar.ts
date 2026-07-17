// Real ADS-B aircraft near the observer, via OpenSky Network's free,
// keyless "all state vectors" endpoint. Returns raw coordinates for
// plotting on a real map (TacticalMap.tsx) — no radar-specific angle/
// distance projection needed once the display is an actual map.

export const RADAR_RANGE_KM = 150;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type Aircraft = {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number;
  altitudeM: number;
  speedKmh: number | null;
  callsign: string;
  originCountry: string;
  distanceKm: number;
};

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

export async function fetchNearbyFlights(lat: number, lon: number): Promise<Aircraft[]> {
  // Bounding box padded past RADAR_RANGE_KM so a circular-range filter
  // below still has full coverage near the edges. 1 degree latitude ≈
  // 111km; longitude degrees shrink with cos(latitude).
  const dLat = (RADAR_RANGE_KM * 1.3) / 111;
  const dLon = dLat / Math.max(0.2, Math.cos(toRad(lat)));
  const params = new URLSearchParams({
    lamin: String(lat - dLat),
    lomin: String(lon - dLon),
    lamax: String(lat + dLat),
    lomax: String(lon + dLon),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  const res = await fetch(`https://opensky-network.org/api/states/all?${params}`, {
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`opensky_http_${res.status}`);
  const data = (await res.json()) as { states: OpenSkyState[] | null };
  const states = data.states ?? [];

  return states
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
        distanceKm: haversineKm(lat, lon, flat as number, flon as number),
      };
    })
    .filter((a) => a.distanceKm <= RADAR_RANGE_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 60);
}
