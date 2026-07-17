import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import type { Aircraft } from "@/lib/geo/flightRadar";

// Real, pannable/zoomable map (vanilla Leaflet — already a dependency,
// previously unused; styles.css already has a `.geo-map` dark/cyan tile
// filter prepared for exactly this). Replaces the old stylized SVG radar
// per direct feedback: a fixed sweep animation with no aircraft in range
// just reads as "broken", not "empty" — a real map makes an empty result
// legible (you can see there's genuinely nothing nearby) and is honestly
// more useful than a radar metaphor for data that isn't actually radar.
//
// Leaflet touches `window` at module-load time, which crashes this app's
// SSR (every route is server-rendered) if imported statically — must be
// loaded dynamically, client-side only, inside an effect. Only *type*
// imports are allowed at the top level (erased at compile time, so they
// never reach the SSR bundle).

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
  aircraft,
  active,
}: {
  lat: number;
  lon: number;
  aircraft: Aircraft[];
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const homeMarkerRef = useRef<LeafletNS.Marker | null>(null);
  const aircraftLayerRef = useRef<LeafletNS.LayerGroup | null>(null);
  // Bumps once Leaflet has finished loading, so the other effects (which
  // depend on leafletRef/mapRef being populated) re-run and pick it up.
  const [ready, setReady] = useState(false);

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
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      aircraftLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
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
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!homeMarkerRef.current) {
      homeMarkerRef.current = L.marker([lat, lon], { icon: homeIcon(L) }).addTo(map);
      map.setView([lat, lon], 9);
    } else {
      homeMarkerRef.current.setLatLng([lat, lon]);
    }
  }, [lat, lon, ready]);

  // Leaflet needs an explicit nudge if its container's size changed after
  // mount (e.g. the acquire overlay disappearing) — it doesn't observe
  // that on its own.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [active, ready]);

  // Aircraft markers.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = aircraftLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const a of aircraft) {
      const color = altitudeColor(a.altitudeM);
      L.marker([a.lat, a.lon], { icon: aircraftIcon(L, a.headingDeg, color) })
        .bindTooltip(
          `${a.callsign} · ${Math.round(a.altitudeM)}m · ${a.speedKmh != null ? `${a.speedKmh}km/h` : "speed n/a"} · ${a.originCountry}`,
        )
        .addTo(layer);
    }
  }, [aircraft, ready]);

  return <div ref={containerRef} className="geo-map absolute inset-0" />;
}
