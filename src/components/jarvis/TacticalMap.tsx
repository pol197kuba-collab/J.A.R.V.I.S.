import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type * as LeafletNS from "leaflet";
import { fetchFlightsInBoundsFn } from "@/lib/geo/flightRadar.functions";
import type { Bounds } from "@/lib/geo/flightRadar";

// Real, pannable/zoomable map (vanilla Leaflet — already a dependency,
// previously unused; styles.css already has a `.geo-map` dark/cyan tile
// filter prepared for exactly this). Replaces the old stylized SVG radar
// per direct feedback: a fixed sweep animation with no aircraft in range
// just reads as "broken", not "empty" — a real map makes an empty result
// legible.
//
// Aircraft load based on the map's own current viewport (like a real
// flight tracker), not a fixed radius around the user's position — panning
// or zooming the map actually loads whatever's airborne wherever you're
// looking. Query is capped to a maximum span (see MAX_QUERY_SPAN_DEG in
// flightRadar.ts) so zooming all the way out to "whole world" doesn't
// burn through OpenSky's daily anonymous quota in one request.
//
// Leaflet touches `window` at module-load time, which crashes this app's
// SSR (every route is server-rendered) if imported statically — must be
// loaded dynamically, client-side only, inside an effect. Only *type*
// imports are allowed at the top level (erased at compile time, so they
// never reach the SSR bundle).

export type FlightStatus = { kind: "ok"; count: number } | { kind: "error" } | { kind: "zoom_in" };

function altitudeColor(altitudeM: number): string {
  if (altitudeM < 3000) return "var(--warning)";
  if (altitudeM < 9000) return "var(--primary)";
  return "var(--success)";
}

function aircraftIcon(L: typeof LeafletNS, headingDeg: number, color: string): LeafletNS.DivIcon {
  return L.divIcon({
    className: "",
    html: `<svg width="20" height="20" viewBox="0 0 24 24" style="transform: rotate(${headingDeg}deg); filter: drop-shadow(0 0 4px ${color})">
      <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="${color}" stroke="${color}" stroke-width="0.5" />
    </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function homeIcon(L: typeof LeafletNS): LeafletNS.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:color-mix(in oklab, var(--primary) 55%, transparent);border:2px solid var(--primary);box-shadow:0 0 10px var(--primary);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function TacticalMap({
  lat,
  lon,
  active,
  onStatusChange,
}: {
  lat: number;
  lon: number;
  active: boolean;
  onStatusChange?: (status: FlightStatus) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const homeMarkerRef = useRef<LeafletNS.Marker | null>(null);
  const aircraftLayerRef = useRef<LeafletNS.LayerGroup | null>(null);
  // Bumps once Leaflet has finished loading, so the other effects (which
  // depend on leafletRef/mapRef being populated) re-run and pick it up.
  const [ready, setReady] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  // Load Leaflet + init the map. Client-only by construction (dynamic
  // import inside an effect never runs during SSR).
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || mapRef.current) return;
    void import("leaflet").then((mod) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = mod.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: 9,
        zoomControl: false,
        attributionControl: true,
        // Page scroll passing over the map would otherwise get hijacked
        // as a zoom gesture (a well-known Leaflet footgun on scrollable
        // pages) — click to focus before scroll-zoom engages. Pinch and
        // double-click zoom still work immediately, unaffected.
        scrollWheelZoom: false,
      });
      map.on("click", () => map.scrollWheelZoom.enable());
      containerRef.current.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      aircraftLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      const updateBounds = () => {
        const b = map.getBounds();
        setBounds({
          lamin: b.getSouth(),
          lomin: b.getWest(),
          lamax: b.getNorth(),
          lomax: b.getEast(),
        });
      };
      map.on("moveend", updateBounds);
      updateBounds();

      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center on the real fix once it's known; keep the home marker synced.
  // `lat`/`lon` only ever change once in practice (FALLBACK → the real
  // geolocation result), so always recentering here — not just on first
  // marker creation — is what makes the view actually follow the real fix
  // once it arrives, instead of leaving the viewport stuck on FALLBACK
  // while only the marker silently jumps to the real location.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!homeMarkerRef.current) {
      homeMarkerRef.current = L.marker([lat, lon], { icon: homeIcon(L) }).addTo(map);
    } else {
      homeMarkerRef.current.setLatLng([lat, lon]);
    }
    map.setView([lat, lon], 9);
  }, [lat, lon, ready]);

  // Leaflet needs an explicit nudge if its container's size changed after
  // mount (e.g. the acquire overlay disappearing) — it doesn't observe
  // that on its own.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [active, ready]);

  // Aircraft for the current viewport.
  const fetchFlights = useServerFn(fetchFlightsInBoundsFn);
  const boundsKey = bounds
    ? `${bounds.lamin.toFixed(1)},${bounds.lomin.toFixed(1)},${bounds.lamax.toFixed(1)},${bounds.lomax.toFixed(1)}`
    : null;
  const { data: result, error } = useQuery({
    queryKey: ["flight-radar", boundsKey],
    queryFn: () => fetchFlights({ data: bounds! }),
    enabled: !!bounds && active,
    staleTime: 85_000,
    refetchInterval: 90_000,
    // A transient origin hiccup (e.g. HTTP 522 — Cloudflare couldn't reach
    // OpenSky's server in time, seen live) shouldn't flash an error for
    // one bad poll; retry a couple of times before giving up.
    retry: 2,
  });

  useEffect(() => {
    if (!onStatusChange) return;
    if (error) onStatusChange({ kind: "error" });
    else if (result && !result.ok) onStatusChange({ kind: "zoom_in" });
    else if (result?.ok) onStatusChange({ kind: "ok", count: result.aircraft.length });
    // onStatusChange intentionally omitted: callers pass an inline setter,
    // and re-running this effect on every parent render (rather than only
    // when the actual query result changes) would be harmless but wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, error]);

  // Aircraft markers.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = aircraftLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (!result?.ok) return;
    for (const a of result.aircraft) {
      const color = altitudeColor(a.altitudeM);
      L.marker([a.lat, a.lon], { icon: aircraftIcon(L, a.headingDeg, color) })
        .bindTooltip(
          `${a.callsign} · ${Math.round(a.altitudeM)}m · ${a.speedKmh != null ? `${a.speedKmh}km/h` : "speed n/a"} · ${a.originCountry}`,
        )
        .addTo(layer);
    }
  }, [result]);

  return <div ref={containerRef} className="geo-map absolute inset-0" />;
}
