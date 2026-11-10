import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { useThemeColors } from "@/lib/theme/themeColor";
import { INCIDENT_LABEL, incidentRuns } from "@/lib/commute/tomtom";
import { minutesOf } from "@/lib/commute/plan";
import type { CommuteIncident, CommuteResult, LatLon } from "@/lib/commute/types";

// Mapa trasy dojazdu. Leaflet ładowany dynamicznie (dotyka `window` przy
// imporcie, a każda trasa jest renderowana po stronie serwera — patrz
// komentarz w TacticalMap, z którego ten wzorzec pochodzi).
//
// WYGLĄD Z TOKENÓW. Kafelki to ciemna mapa CARTO, ale przechodzą przez filtr
// duotone SVG (`#commute-duotone`), którego dwa kolory — cień i światło —
// są liczone z tokenów motywu (`--background`, `--primary`). Zmiana motywu
// (np. Town) przefarbowuje mapę sama; żadnego koloru na sztywno nie ma.
// Trasa, objazd i znaczniki to klasy CSS (.commute-*, w styles.css), bo
// atrybuty prezentacji SVG nie rozwiązują `var()`.
//
// DWA TRYBY. Płaski: zwykła, interaktywna mapa. Pochylony (3D, „dane w
// przestrzeni"): ta sama mapa leży na pochylonej płaszczyźnie w świetle, a
// znaczniki stoją nad nią jako zwykły HTML — ich pozycje ekranowe
// odczytujemy z niewidzialnych sond w mapie (przeglądarka sama rzutuje je
// przez transformację), bo `overflow:hidden` Leaflet spłaszcza kontekst 3D.

type Pin = {
  key: string;
  at: LatLon;
  text: string;
  /** Wartość CSS koloru, np. "var(--primary)". */
  color: string;
};

const SPEC = {
  dark: "var(--background)",
  light: "color-mix(in oklab, var(--primary) 62%, var(--background))",
} as const;
const FALLBACK = { dark: "#050a14", light: "#2e8fa8" } as const;

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Filtr duotone: luminancja kafelka → gradient od `dark` do `light`. */
function DuotoneFilter() {
  const c = useThemeColors(SPEC, FALLBACK);
  const [dr, dg, db] = toRgb(c.dark);
  const [lr, lg, lb] = toRgb(c.light);
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <filter id="commute-duotone" colorInterpolationFilters="sRGB">
        {/* do szarości, z rozciągnięciem wąskiego zakresu ciemnych kafelków */}
        <feColorMatrix
          type="matrix"
          values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
        />
        <feComponentTransfer>
          <feFuncR type="linear" slope="3.4" intercept="0" />
          <feFuncG type="linear" slope="3.4" intercept="0" />
          <feFuncB type="linear" slope="3.4" intercept="0" />
        </feComponentTransfer>
        <feComponentTransfer>
          <feFuncR type="table" tableValues={`${dr} ${lr}`} />
          <feFuncG type="table" tableValues={`${dg} ${lg}`} />
          <feFuncB type="table" tableValues={`${db} ${lb}`} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

const incidentColor = (i: CommuteIncident) =>
  i.kind === "accident" || i.kind === "closure" || i.severity >= 3
    ? "var(--destructive)"
    : "var(--warning)";

function incidentText(i: CommuteIncident): string {
  const mins = i.delaySec ? ` +${minutesOf(i.delaySec)}` : "";
  return `${INCIDENT_LABEL[i.kind]}${mins}`;
}

function buildPins(result: CommuteResult): Pin[] {
  const toWork = result.direction === "to";
  const pins: Pin[] = [
    {
      key: "origin",
      at: result.origin,
      text: toWork ? "DOM" : "PRACA",
      color: toWork ? "var(--primary)" : "var(--reactor)",
    },
    {
      key: "dest",
      at: result.destination,
      text: toWork ? "PRACA" : "DOM",
      color: toWork ? "var(--reactor)" : "var(--primary)",
    },
  ];
  for (const i of result.incidents
    .filter((x) => result.main.incidentIds.includes(x.id))
    .slice(0, 6)) {
    pins.push({ key: `inc-${i.id}`, at: i.at, text: incidentText(i), color: incidentColor(i) });
  }
  return pins;
}

const pinHtml = (p: Pin) =>
  `<div class="commute-pin" style="--c:${p.color}"><b>${p.text}</b><i></i></div>`;

export function CommuteMap({
  result,
  showDetour,
  tilt,
}: {
  result: CommuteResult;
  showDetour: boolean;
  tilt: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const probesRef = useRef<Array<{ pin: Pin; marker: LeafletNS.Marker }>>([]);
  const fittedFor = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [screenPins, setScreenPins] = useState<Array<Pin & { x: number; y: number }>>([]);

  const pins = useMemo(() => buildPins(result), [result]);
  const viewKey = `${result.direction}:${result.origin.lat},${result.origin.lon}:${result.destination.lat},${result.destination.lon}`;

  // Pozycje ekranowe sond → znaczniki HTML (tryb pochylony).
  const reproject = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !tilt) {
      setScreenPins([]);
      return;
    }
    const box = stage.getBoundingClientRect();
    const out: Array<Pin & { x: number; y: number }> = [];
    for (const { pin, marker } of probesRef.current) {
      const el = marker.getElement();
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - box.left;
      const y = r.top + r.height / 2 - box.top;
      if (x < -20 || y < -20 || x > box.width + 20 || y > box.height + 20) continue;
      out.push({ ...pin, x, y });
    }
    setScreenPins(out);
  }, [tilt]);

  // Leaflet + mapa — raz, tylko w przeglądarce.
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || mapRef.current) return;
    void import("leaflet").then((mod) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = mod.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [result.origin.lat, result.origin.lon],
        zoom: 11,
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        // Drobniejszy skok zoomu: przy skoku co 1 trasa zajmowała czasem połowę
        // kadru, bo fitBounds zaokrągla w dół do pełnego poziomu.
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      });
      map.attributionControl.setPrefix(false);
      map.on("click", () => map.scrollWheelZoom.enable());
      containerRef.current.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap, &copy; CARTO · TomTom",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rysowanie: trasa, odcinki z utrudnieniem, objazd, znaczniki.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    probesRef.current = [];

    const ll = (p: LatLon): LeafletNS.LatLngTuple => [p.lat, p.lon];
    const main = result.main.points.map(ll);

    if (showDetour && result.detour) {
      L.polyline(result.detour.route.points.map(ll), {
        className: "commute-detour",
        weight: 4,
        interactive: false,
        lineCap: "round",
      }).addTo(layer);
    }
    L.polyline(main, { className: "commute-route-glow", weight: 14, interactive: false }).addTo(
      layer,
    );
    L.polyline(main, { className: "commute-route", weight: 4, interactive: false }).addTo(layer);
    for (const run of incidentRuns(result.main, result.incidents)) {
      L.polyline(run.map(ll), {
        className: "commute-route-hot",
        weight: 5,
        interactive: false,
      }).addTo(layer);
    }

    for (const pin of pins) {
      if (tilt) {
        const marker = L.marker(ll(pin.at), {
          icon: L.divIcon({ className: "commute-probe", iconSize: [2, 2], iconAnchor: [1, 1] }),
          interactive: false,
          keyboard: false,
        }).addTo(layer);
        probesRef.current.push({ pin, marker });
      } else {
        L.marker(ll(pin.at), {
          icon: L.divIcon({
            className: "commute-pin-wrap",
            html: pinHtml(pin),
            iconSize: [0, 0],
          }),
          keyboard: false,
        }).addTo(layer);
      }
    }

    if (fittedFor.current !== `${viewKey}:${tilt}`) {
      fittedFor.current = `${viewKey}:${tilt}`;
      const pts = [
        ...main,
        ...(showDetour && result.detour ? result.detour.route.points.map(ll) : []),
      ];
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(pts), {
        padding: tilt ? [90, 90] : [48, 48],
        animate: false,
      });
    }
    requestAnimationFrame(reproject);
  }, [ready, result, pins, showDetour, tilt, viewKey, reproject]);

  // Zmiana trybu zmienia rozmiar płaszczyzny — mapa musi się o tym dowiedzieć,
  // a znaczniki 3D przeliczyć po zakończeniu animacji pochylenia.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tilt) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
    }
    const t = setTimeout(() => {
      map.invalidateSize();
      reproject();
    }, 750);
    return () => clearTimeout(t);
  }, [tilt, ready, reproject]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on("moveend zoomend", reproject);
    window.addEventListener("resize", reproject);
    return () => {
      map.off("moveend zoomend", reproject);
      window.removeEventListener("resize", reproject);
    };
  }, [ready, reproject]);

  const fit = () => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    map.fitBounds(
      L.latLngBounds(result.main.points.map((p) => [p.lat, p.lon] as LeafletNS.LatLngTuple)),
      {
        padding: tilt ? [90, 90] : [48, 48],
      },
    );
  };

  return (
    <div ref={stageRef} className="commute-stage">
      <DuotoneFilter />
      <div className="commute-plane" data-tilt={tilt ? "true" : "false"}>
        <div ref={containerRef} className="commute-map absolute inset-0" />
      </div>

      {tilt && (
        <div className="pointer-events-none absolute inset-0">
          {screenPins.map((p) => (
            <div
              key={p.key}
              className="commute-pin-3d"
              style={{ left: p.x, top: p.y, ["--c" as string]: p.color }}
            >
              <b>{p.text}</b>
              <i />
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-[500] flex flex-col gap-1">
        {(
          [
            ["+", "Przybliż", () => mapRef.current?.zoomIn()],
            ["−", "Oddal", () => mapRef.current?.zoomOut()],
            ["⌖", "Cała trasa", fit],
          ] as const
        ).map(([glyph, label, run]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={run}
            className="commute-map-btn"
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
