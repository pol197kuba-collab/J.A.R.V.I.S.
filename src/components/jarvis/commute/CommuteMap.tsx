import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { useThemeColors } from "@/lib/theme/themeColor";
import { INCIDENT_LABEL, incidentRuns } from "@/lib/commute/tomtom";
import { minutesOf } from "@/lib/commute/plan";
import type {
  CommuteIncident,
  CommuteOption,
  CommuteResult,
  LatLon,
  ViaPoint,
} from "@/lib/commute/types";

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

function buildPins(result: CommuteResult, selected: CommuteOption): Pin[] {
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
    .filter((x) => selected.route.incidentIds.includes(x.id))
    .slice(0, 6)) {
    pins.push({ key: `inc-${i.id}`, at: i.at, text: incidentText(i), color: incidentColor(i) });
  }
  return pins;
}

const pinHtml = (p: Pin) =>
  `<div class="commute-pin" style="--c:${p.color}"><b>${p.text}</b><i></i></div>`;

/** Kafelki TomTom (styl nocny) — ten sam klucz co trasy; wymaga produktu Map Display API. */
const tileUrl = (key: string) =>
  `https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&language=pl-PL`;

/** Tyle nieudanych kafelków z rzędu uznajemy za „podkład niedostępny". */
const TILE_ERRORS_BEFORE_HINT = 4;

/** Tryb edycji trasy: klik na mapie dodaje punkt pośredni, pinezki da się przeciągać. */
export type CommuteEditorOverlay = {
  via: ViaPoint[];
  /** Podgląd trasy z tymi punktami; null, dopóki nie wróci z serwera. */
  preview: LatLon[] | null;
  onAdd: (p: LatLon) => void;
  onMove: (index: number, p: LatLon) => void;
};

export function CommuteMap({
  result,
  selectedId,
  showDetour,
  tilt,
  tileKey,
  editor,
}: {
  result: CommuteResult;
  /** Która trasa jest „wybrana" (podświetlona); nieznane id = domyślna. */
  selectedId: string | null;
  showDetour: boolean;
  tilt: boolean;
  editor?: CommuteEditorOverlay | null;
  /** Klucz do kafelków; null = mapa bez podkładu (sama trasa na ciemnym tle). */
  tileKey: string | null;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const probesRef = useRef<Array<{ pin: Pin; marker: LeafletNS.Marker }>>([]);
  const tileLayerRef = useRef<LeafletNS.TileLayer | null>(null);
  const fittedFor = useRef<string | null>(null);
  const [tilesBlocked, setTilesBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [screenPins, setScreenPins] = useState<Array<Pin & { x: number; y: number }>>([]);

  const selected = useMemo(
    () => result.options.find((o) => o.id === selectedId) ?? result.options[0],
    [result, selectedId],
  );
  const pins = useMemo(() => buildPins(result, selected), [result, selected]);
  // Callbacki edytora przez ref: mapa tworzy się raz i nie może trzymać starych.
  const editorRef = useRef<CommuteEditorOverlay | null>(null);
  editorRef.current = editor ?? null;
  const editing = !!editor;
  const editorKey = editor ? JSON.stringify([editor.via, editor.preview?.length ?? 0]) : "";
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
      map.on("click", (e: LeafletNS.LeafletMouseEvent) => {
        map.scrollWheelZoom.enable();
        editorRef.current?.onAdd({ lat: e.latlng.lat, lon: e.latlng.lng });
      });
      containerRef.current.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
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

  // Podkład: kafelki TomTom. Osobny efekt, bo klucz dochodzi z serwera już po
  // utworzeniu mapy. Bez klucza (albo gdy TomTom odmawia kafelków, np. klucz
  // nie ma produktu Map Display API) zostaje sama trasa na ciemnym tle —
  // czytelna, tylko bez ulic.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    tileLayerRef.current?.remove();
    tileLayerRef.current = null;
    setTilesBlocked(false);
    if (!tileKey) return;
    let errors = 0;
    const layer = L.tileLayer(tileUrl(tileKey), {
      attribution: "&copy; TomTom, &copy; OpenStreetMap",
      maxZoom: 18,
      tileSize: 256,
    });
    layer.on("tileerror", () => {
      errors += 1;
      if (errors === TILE_ERRORS_BEFORE_HINT) setTilesBlocked(true);
    });
    layer.on("tileload", () => {
      errors = 0;
      setTilesBlocked(false);
    });
    layer.addTo(map);
    layer.bringToBack();
    tileLayerRef.current = layer;
    return () => {
      layer.remove();
    };
  }, [ready, tileKey]);

  // Rysowanie: trasa, odcinki z utrudnieniem, objazd, znaczniki.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    probesRef.current = [];

    const ll = (p: LatLon): LeafletNS.LatLngTuple => [p.lat, p.lon];
    const main = selected.route.points.map(ll);
    const detourId = showDetour && result.detour ? result.detour.optionId : null;

    // Pozostałe trasy: objazd wyraźnie (przerywana), reszta ledwo widoczna.
    for (const o of result.options) {
      if (o.id === selected.id && !editing) continue;
      const isDetour = !editing && o.id === detourId;
      L.polyline(o.route.points.map(ll), {
        className: isDetour ? "commute-detour" : "commute-other",
        weight: isDetour ? 4 : 3,
        interactive: false,
        lineCap: "round",
      }).addTo(layer);
    }

    const ed = editorRef.current;
    if (ed) {
      // Edycja: pokazujemy podgląd trasy z punktami, a numerowane pinezki da się przeciągać.
      if (ed.preview && ed.preview.length > 1) {
        const pv = ed.preview.map(ll);
        L.polyline(pv, { className: "commute-route-glow", weight: 14, interactive: false }).addTo(
          layer,
        );
        L.polyline(pv, { className: "commute-route", weight: 4, interactive: false }).addTo(layer);
      }
      ed.via.forEach((v, i) => {
        const m = L.marker(ll(v), {
          draggable: true,
          icon: L.divIcon({
            className: "commute-pin-wrap",
            html: `<div class="commute-via">${i + 1}</div>`,
            iconSize: [0, 0],
          }),
          keyboard: false,
        }).addTo(layer);
        m.on("dragend", () => {
          const at = m.getLatLng();
          editorRef.current?.onMove(i, { lat: at.lat, lon: at.lng });
        });
      });
    } else {
      L.polyline(main, { className: "commute-route-glow", weight: 14, interactive: false }).addTo(
        layer,
      );
      L.polyline(main, { className: "commute-route", weight: 4, interactive: false }).addTo(layer);
      for (const run of incidentRuns(selected.route, result.incidents)) {
        L.polyline(run.map(ll), {
          className: "commute-route-hot",
          weight: 5,
          interactive: false,
        }).addTo(layer);
      }
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
      const pts = result.options.flatMap((o) => o.route.points.map(ll));
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(pts), {
        padding: tilt ? [90, 90] : [48, 48],
        animate: false,
      });
    }
    requestAnimationFrame(reproject);
  }, [ready, result, selected, pins, showDetour, tilt, viewKey, reproject, editing, editorKey]);

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
        <div
          ref={containerRef}
          className={`commute-map absolute inset-0${editing ? " commute-editing" : ""}`}
        />
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

      {tileKey === null || tilesBlocked ? (
        <p className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-[60%] font-display text-[9px] uppercase tracking-[0.18em] text-warning">
          {tileKey === null
            ? "Brak podkładu mapy — dodaj klucz TomTom"
            : "Podkład niedostępny — włącz Map Display API w kluczu TomTom"}
        </p>
      ) : null}

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
