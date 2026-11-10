// DOJAZD — rozmowa z TomTom (trasy z ruchem, utrudnienia, adresy). Tylko
// serwer: klucz nie opuszcza backendu. Wszystkie błędy mają prefiks
// „TomTom HTTP <status>", żeby alarm o padniętym kluczu
// (providerKeys.findKeyFailures) umiał je rozpoznać w System Logs.
import { incidentBoxes } from "./geo";
import { assembleOptions } from "./options";
import { attachIncidents, mergeIncidents, parseIncidents, parseRoutes, pickDetour } from "./tomtom";
import type {
  CommuteDirection,
  CommuteIncident,
  CommuteResult,
  CommuteRoute,
  Detour,
  LatLon,
  SavedRoute,
} from "./types";
import type { DeparturePlan } from "./plan";

const BASE = "https://api.tomtom.com";
const TIMEOUT_MS = 12_000;

async function getJson(url: string, what: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (cause) {
      throw new Error(
        ctrl.signal.aborted
          ? `TomTom ${what}: brak odpowiedzi w ${TIMEOUT_MS / 1000} s`
          : `TomTom ${what}: połączenie nieudane (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`TomTom HTTP ${res.status} (${what}): ${body}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** RFC3339 w UTC bez ułamków sekund — taki zapis TomTom przyjmuje w departAt. */
const rfc3339 = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function fetchRoutes(
  key: string,
  from: LatLon,
  to: LatLon,
  plan: DeparturePlan,
  opts: { via?: readonly LatLon[]; alternatives?: number } = {},
): Promise<CommuteRoute[]> {
  const via = opts.via ?? [];
  const params = new URLSearchParams({
    key,
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    // Trasa z punktami pośrednimi jest jedna — alternatyw dla niej nie liczymy
    // (TomTom ich w tym trybie nie daje), a automatyczne propozycje idą osobnym
    // zapytaniem bez tych punktów.
    maxAlternatives: String(via.length > 0 ? 0 : (opts.alternatives ?? 2)),
    computeTravelTimeFor: "all",
    instructionsType: "text",
    language: "pl-PL",
    routeRepresentation: "polyline",
  });
  // „Teraz" = bez departAt (żywy ruch); inaczej godzina z planu.
  if (!plan.live) params.set("departAt", rfc3339(plan.at));
  const stops = [from, ...via, to].map((p) => `${p.lat},${p.lon}`).join(":");
  const url = `${BASE}/routing/1/calculateRoute/${stops}/json?` + params.toString();
  const routes = parseRoutes(await getJson(url, "trasa"));
  if (routes.length === 0) throw new Error("TomTom trasa: odpowiedź bez żadnej trasy");
  return routes;
}

const INCIDENT_FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay," +
  "events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers}}}";

export async function fetchIncidents(
  key: string,
  routePoints: readonly LatLon[],
): Promise<CommuteIncident[]> {
  const boxes = incidentBoxes(routePoints);
  const lists = await Promise.all(
    boxes.map(async (b) => {
      const params = new URLSearchParams({
        key,
        bbox: `${b.minLon.toFixed(5)},${b.minLat.toFixed(5)},${b.maxLon.toFixed(5)},${b.maxLat.toFixed(5)}`,
        fields: INCIDENT_FIELDS,
        language: "pl-PL",
        timeValidityFilter: "present",
      });
      return parseIncidents(
        await getJson(`${BASE}/traffic/services/5/incidentDetails?${params}`, "utrudnienia"),
      );
    }),
  );
  return mergeIncidents(lists);
}

export type GeocodeHit = { label: string; lat: number; lon: number };

export async function geocode(key: string, query: string): Promise<GeocodeHit[]> {
  const params = new URLSearchParams({
    key,
    limit: "5",
    countrySet: "PL",
    language: "pl-PL",
    idxSet: "PAD,Addr,Str,POI",
  });
  const json = (await getJson(
    `${BASE}/search/2/search/${encodeURIComponent(query)}.json?${params}`,
    "adres",
  )) as { results?: Array<Record<string, unknown>> };
  const out: GeocodeHit[] = [];
  for (const r of json.results ?? []) {
    const pos = r.position as { lat?: unknown; lon?: unknown } | undefined;
    const addr = r.address as { freeformAddress?: unknown } | undefined;
    const poi = r.poi as { name?: unknown } | undefined;
    if (typeof pos?.lat !== "number" || typeof pos?.lon !== "number") continue;
    const address = typeof addr?.freeformAddress === "string" ? addr.freeformAddress : "";
    const name = typeof poi?.name === "string" ? poi.name : "";
    const label = name && address ? `${name}, ${address}` : address || name;
    if (label) out.push({ label, lat: pos.lat, lon: pos.lon });
  }
  return out;
}

/**
 * Cała robota dla jednego kierunku: trasy zapisane (z punktami pośrednimi),
 * automatyczne propozycje (bez nich), utrudnienia i objazd.
 *
 * `main` to trasa DOMYŚLNA — zapisana z gwiazdką, a bez niej najszybsza
 * automatyczna. To ją czytają briefing, kafelek, dock i alert, a objazd
 * porównujemy z nią, nie z tym, co wybrałaby mapa.
 */
export async function buildCommute(
  key: string,
  direction: CommuteDirection,
  origin: LatLon & { label: string },
  destination: LatLon & { label: string },
  plan: DeparturePlan,
  saved: readonly SavedRoute[] = [],
): Promise<CommuteResult> {
  const [auto, ...savedRoutes] = await Promise.all([
    fetchRoutes(key, origin, destination, plan),
    // Zapisana trasa, której TomTom nie umie wyznaczyć (np. punkt poza drogą),
    // nie może zabrać całego wyniku — pomijamy ją, reszta działa.
    ...saved.map((meta) =>
      fetchRoutes(key, origin, destination, plan, { via: meta.via })
        .then((r) => ({ meta, route: r[0] }))
        .catch(() => null),
    ),
  ]);
  const savedOk = (savedRoutes as Array<{ meta: SavedRoute; route: CommuteRoute } | null>).filter(
    (x): x is { meta: SavedRoute; route: CommuteRoute } => x !== null && !!x.route,
  );

  const { options, defaultId } = assembleOptions(savedOk, auto);
  const def = options.find((o) => o.id === defaultId) ?? options[0];
  const others = options.filter((o) => o !== def);
  const allRoutes = options.map((o) => o.route);

  // Utrudnienia są DODATKIEM do czasu przejazdu. Padnięte pobranie nie może
  // zabrać samego czasu dojazdu — czas z ruchem już je w sobie zawiera.
  let incidents: CommuteIncident[] = [];
  try {
    const all = await fetchIncidents(
      key,
      allRoutes.flatMap((r) => r.points),
    );
    incidents = attachIncidents(allRoutes, all);
  } catch {
    incidents = [];
  }

  const detour: Detour | null = pickDetour(def.route, others, incidents);
  return {
    direction,
    origin,
    destination,
    main: def.route,
    alternatives: others.map((o) => o.route),
    options,
    defaultId: def.id,
    incidents,
    detour,
    live: plan.live,
    fetchedAt: new Date().toISOString(),
  };
}
