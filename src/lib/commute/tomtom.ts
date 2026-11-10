// DOJAZD — czyste parsowanie odpowiedzi TomTom i wybór objazdu. Bez sieci i
// bez bazy: dostaje JSON-a, oddaje typy z ./types. Sieć jest w tomtom.server.ts.
import { anyNearPolyline, decimate, overlapFraction } from "./geo";
import type {
  CommuteIncident,
  CommuteOption,
  CommuteRoute,
  Detour,
  IncidentKind,
  LatLon,
  StreetRun,
} from "./types";

const MAX_ROUTE_POINTS = 300;
const MAX_INCIDENT_POINTS = 24;
/** Utrudnienie „leży na trasie", gdy któryś jego punkt jest bliżej niż to. */
export const ON_ROUTE_M = 120;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Trasy
// ---------------------------------------------------------------------------

function streetRuns(instructions: unknown, totalM: number): StreetRun[] {
  if (!Array.isArray(instructions)) return [];
  const steps = instructions
    .filter(isRec)
    .map((i) => ({
      offset: num(i.routeOffsetInMeters) ?? 0,
      name: str(i.street) ?? (Array.isArray(i.roadNumbers) ? str(i.roadNumbers[0]) : null),
    }))
    .sort((a, b) => a.offset - b.offset);
  const byName = new Map<string, number>();
  steps.forEach((s, idx) => {
    if (!s.name) return;
    const end = idx + 1 < steps.length ? steps[idx + 1].offset : totalM;
    const meters = Math.max(0, end - s.offset);
    byName.set(s.name, (byName.get(s.name) ?? 0) + meters);
  });
  return [...byName.entries()]
    .map(([name, meters]) => ({ name, meters }))
    .sort((a, b) => b.meters - a.meters);
}

/** Wszystkie trasy z odpowiedzi calculateRoute (główna pierwsza). */
export function parseRoutes(json: unknown): CommuteRoute[] {
  if (!isRec(json) || !Array.isArray(json.routes)) return [];
  const out: CommuteRoute[] = [];
  for (const r of json.routes) {
    if (!isRec(r) || !isRec(r.summary)) continue;
    const s = r.summary;
    const duration = num(s.travelTimeInSeconds);
    const distance = num(s.lengthInMeters);
    if (duration === null || distance === null) continue;

    const points: LatLon[] = [];
    if (Array.isArray(r.legs)) {
      for (const leg of r.legs) {
        if (!isRec(leg) || !Array.isArray(leg.points)) continue;
        for (const p of leg.points) {
          if (isRec(p) && num(p.latitude) !== null && num(p.longitude) !== null) {
            points.push({ lat: p.latitude as number, lon: p.longitude as number });
          }
        }
      }
    }
    if (points.length < 2) continue;

    const guidance = isRec(r.guidance) ? r.guidance : null;
    out.push({
      points: decimate(points, MAX_ROUTE_POINTS),
      distanceM: distance,
      durationSec: duration,
      typicalSec: num(s.historicTrafficTravelTimeInSeconds) ?? num(s.noTrafficTravelTimeInSeconds),
      freeFlowSec: num(s.noTrafficTravelTimeInSeconds),
      departAt: str(s.departureTime),
      arriveAt: str(s.arrivalTime),
      streets: streetRuns(guidance?.instructions, distance),
      incidentIds: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utrudnienia
// ---------------------------------------------------------------------------

/** iconCategory z TomTom Traffic Incidents v5 → nasz rodzaj. */
export function incidentKind(icon: number | null): IncidentKind {
  switch (icon) {
    case 1:
      return "accident";
    case 8:
      return "closure";
    case 7:
      return "lane";
    case 9:
      return "roadworks";
    case 6:
      return "jam";
    case 14:
      return "breakdown";
    case 2:
    case 3:
    case 4:
    case 5:
    case 10:
    case 11:
      return "hazard";
    default:
      return "other";
  }
}

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  accident: "WYPADEK",
  closure: "ZAMKNIĘCIE",
  lane: "ZWĘŻENIE",
  roadworks: "ROBOTY",
  jam: "KOREK",
  breakdown: "AWARIA",
  hazard: "UTRUDNIENIE",
  other: "UTRUDNIENIE",
};

export function parseIncidents(json: unknown): CommuteIncident[] {
  if (!isRec(json) || !Array.isArray(json.incidents)) return [];
  const out: CommuteIncident[] = [];
  for (const inc of json.incidents) {
    if (!isRec(inc) || !isRec(inc.properties)) continue;
    const p = inc.properties;
    const g = isRec(inc.geometry) ? inc.geometry : null;
    const coords: unknown[] = Array.isArray(g?.coordinates) ? (g.coordinates as unknown[]) : [];
    // Point: [lon, lat]; LineString: [[lon, lat], ...]
    const raw: unknown[] =
      coords.length > 0 && Array.isArray(coords[0]) ? coords : coords.length === 2 ? [coords] : [];
    const positions: LatLon[] = raw
      .filter((c): c is unknown[] => Array.isArray(c) && c.length >= 2)
      .map((c) => ({ lat: Number(c[1]), lon: Number(c[0]) }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
    if (positions.length === 0) continue;

    const events = Array.isArray(p.events) ? p.events.filter(isRec) : [];
    const icon = num(events[0]?.iconCategory) ?? num(p.iconCategory);
    const roads = Array.isArray(p.roadNumbers)
      ? p.roadNumbers.map(str).filter((x): x is string => x !== null)
      : [];
    const id = str(p.id) ?? `${positions[0].lat.toFixed(5)},${positions[0].lon.toFixed(5)}`;
    out.push({
      id,
      kind: incidentKind(icon),
      severity: num(p.magnitudeOfDelay) ?? 0,
      road: roads.length ? roads.join(", ") : null,
      from: str(p.from),
      to: str(p.to),
      description: str(events[0]?.description),
      delaySec: num(p.delay),
      lengthM: num(p.length),
      startTime: str(p.startTime),
      endTime: str(p.endTime),
      positions: decimate(positions, MAX_INCIDENT_POINTS),
      at: positions[Math.floor(positions.length / 2)],
    });
  }
  return out;
}

/**
 * Czy utrudnienie jest warte uwagi kierowcy. Drobne korki i pogodowe
 * ostrzeżenia bez wpływu na ruch nauczyłyby ignorować całą listę.
 */
export function isRelevantIncident(i: CommuteIncident): boolean {
  if (i.kind === "closure" || i.kind === "accident") return true;
  if (i.kind === "lane" || i.kind === "roadworks" || i.kind === "breakdown") return i.severity >= 1;
  if (i.kind === "jam") return i.severity >= 2;
  return i.severity >= 3;
}

/** Łączy listy z kilku prostokątów, bez powtórzeń po id. */
export function mergeIncidents(lists: readonly CommuteIncident[][]): CommuteIncident[] {
  const seen = new Map<string, CommuteIncident>();
  for (const list of lists) for (const i of list) if (!seen.has(i.id)) seen.set(i.id, i);
  return [...seen.values()];
}

/**
 * Przypisuje utrudnienia do tras i zwraca te, które leżą na którejkolwiek.
 * Mutuje `incidentIds` w trasach — to wynik, nie wejście.
 */
export function attachIncidents(
  routes: CommuteRoute[],
  incidents: readonly CommuteIncident[],
): CommuteIncident[] {
  const relevant = incidents.filter(isRelevantIncident);
  const used = new Set<string>();
  for (const route of routes) {
    route.incidentIds = relevant
      .filter((i) => anyNearPolyline(i.positions, route.points, ON_ROUTE_M))
      .map((i) => i.id);
    route.incidentIds.forEach((id) => used.add(id));
  }
  return relevant
    .filter((i) => used.has(i.id))
    .sort((a, b) => b.severity - a.severity || (b.delaySec ?? 0) - (a.delaySec ?? 0));
}

// ---------------------------------------------------------------------------
// Objazd
// ---------------------------------------------------------------------------

/** Objazd krótszy o tyle jest wart zmiany trasy sam z siebie. */
export const DETOUR_FASTER_SEC = 180;
/** Objazd omijający poważne utrudnienie może być dłuższy najwyżej o tyle. */
export const DETOUR_MAX_SLOWER_SEC = 300;
/** Trasa pokrywająca się z główną w tym stopniu nie jest objazdem. */
const SAME_ROUTE_OVERLAP = 0.9;

/** Ulice, którymi `alt` różni się od `main` — najdłuższe pierwsze. */
export function viaStreets(main: CommuteRoute, alt: CommuteRoute, max = 3): string[] {
  const known = new Set(main.streets.map((s) => s.name));
  return alt.streets
    .filter((s) => !known.has(s.name) && s.meters >= 300)
    .slice(0, max)
    .map((s) => s.name);
}

export function pickDetour(
  main: CommuteRoute,
  candidates: readonly CommuteOption[],
  incidents: readonly CommuteIncident[],
): Detour | null {
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const serious = (ids: string[]) =>
    ids.filter((id) => {
      const i = byId.get(id);
      return i && (i.kind === "closure" || i.kind === "accident" || i.severity >= 3);
    });
  const mainSerious = serious(main.incidentIds);

  let best: Detour | null = null;
  for (const option of candidates) {
    const alt = option.route;
    if (overlapFraction(alt.points, main.points, 80) >= SAME_ROUTE_OVERLAP) continue;
    const saves = main.durationSec - alt.durationSec;
    const altSerious = serious(alt.incidentIds);
    let reason: Detour["reason"] | null = null;
    if (saves >= DETOUR_FASTER_SEC) reason = "faster";
    else if (mainSerious.length > 0 && altSerious.length === 0 && saves >= -DETOUR_MAX_SLOWER_SEC) {
      reason = "avoids_incident";
    }
    if (!reason) continue;
    if (!best || alt.durationSec < best.route.durationSec) {
      best = {
        optionId: option.id,
        name: option.kind === "saved" ? option.name : null,
        route: alt,
        savesSec: saves,
        via: viaStreets(main, alt),
        reason,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Odcinki trasy dotknięte utrudnieniem (do czerwonego podświetlenia na mapie)
// ---------------------------------------------------------------------------

/**
 * Fragmenty trasy leżące przy poważnych utrudnieniach, jako łamane do
 * narysowania. Sąsiednie punkty łączą się w jeden odcinek; każdy odcinek
 * wychodzi o jeden punkt poza utrudnienie, żeby kreska nie miała dziur.
 */
export function incidentRuns(
  route: CommuteRoute,
  incidents: readonly CommuteIncident[],
): LatLon[][] {
  const hits = incidents.filter(
    (i) =>
      route.incidentIds.includes(i.id) &&
      (i.kind === "closure" || i.kind === "accident" || i.severity >= 2),
  );
  if (hits.length === 0) return [];
  const bad = route.points.map((p) =>
    hits.some((i) =>
      anyNearPolyline(
        [p],
        i.positions.length > 1 ? i.positions : [i.positions[0], i.positions[0]],
        ON_ROUTE_M,
      ),
    ),
  );
  const runs: LatLon[][] = [];
  let start = -1;
  for (let i = 0; i <= bad.length; i++) {
    if (i < bad.length && bad[i]) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      const from = Math.max(0, start - 1);
      const to = Math.min(route.points.length - 1, i);
      runs.push(route.points.slice(from, to + 1));
      start = -1;
    }
  }
  return runs;
}
