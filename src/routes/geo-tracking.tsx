import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";

export const Route = createFileRoute("/geo-tracking")({
  head: () => ({
    meta: [
      { title: "JARVIS // Geo-Tracking" },
      { name: "description", content: "Satellite geo-tracking grid pinpointing the host signature." },
      { property: "og:title", content: "JARVIS // Geo-Tracking" },
      { property: "og:description", content: "Satellite geo-tracking grid pinpointing the host signature." },
    ],
  }),
  component: GeoTrackingPage,
});

type Fix = {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  heading: number | null;
  source: "GPS" | "DEFAULT";
};

const FALLBACK: Fix = {
  lat: 52.2297,
  lon: 21.0122,
  accuracy: 9999,
  altitude: null,
  heading: null,
  source: "DEFAULT",
};

function GeoTrackingPage() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const [fix, setFix] = useState<Fix>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: import("leaflet").Map | null = null;
    let marker: import("leaflet").CircleMarker | null = null;
    let ro: ResizeObserver | null = null;
    let rafId = 0;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapEl.current) return;
      const m = L.map(mapEl.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
      }).setView([FALLBACK.lat, FALLBACK.lon], 12);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
        { maxZoom: 19, subdomains: "abcd" },
      ).addTo(m);
      mapInstance = m;

      marker = L.circleMarker([FALLBACK.lat, FALLBACK.lon], {
        radius: 6,
        color: "#22d3ee",
        weight: 2,
        fillColor: "#22d3ee",
        fillOpacity: 0.85,
      }).addTo(m);

      // Container often has 0 size on first mount (route transition / flex parent).
      // Force leaflet to recompute size once layout settles.
      const kick = () => {
        if (cancelled || !mapInstance) return;
        mapInstance.invalidateSize();
      };
      rafId = requestAnimationFrame(() => {
        kick();
        setTimeout(kick, 60);
        setTimeout(kick, 300);
      });
      if (typeof ResizeObserver !== "undefined" && mapEl.current) {
        ro = new ResizeObserver(() => kick());
        ro.observe(mapEl.current);
      }

      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const f: Fix = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              heading: pos.coords.heading,
              source: "GPS",
            };
            setFix(f);
            m.setView([f.lat, f.lon], 14, { animate: true });
            marker?.setLatLng([f.lat, f.lon]);
            m.invalidateSize();
          },
          () => {},
          { enableHighAccuracy: true, timeout: 8000 },
        );
      }
    })();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro?.disconnect();
      mapInstance?.remove();
    };
  }, []);

  return (
    <div className="space-y-3 p-3 landscape:max-md:space-y-2 landscape:max-md:p-2">
      <HudPanel index={0} title="GEO-TRACKING // ORBITAL UPLINK" className="p-3 landscape:max-md:p-2">
        <div className="grid grid-cols-2 gap-2 pt-2 font-display text-[10px] uppercase tracking-[0.2em] landscape:max-md:text-[9px]">
          <div className="flex justify-between border-b border-primary/15 pb-0.5">
            <span className="text-primary/60">SIGNATURE</span>
            <span className="text-[color:var(--success)]">
              {fix.source === "GPS" ? "● PINPOINTED" : "● DEFAULT GRID"}
            </span>
          </div>
          <div className="flex justify-between border-b border-primary/15 pb-0.5">
            <span className="text-primary/60">ACCURACY</span>
            <span className="text-foreground/85">±{Math.round(fix.accuracy)}m</span>
          </div>
          <div className="flex justify-between border-b border-primary/15 pb-0.5">
            <span className="text-primary/60">LAT</span>
            <span className="text-foreground/85 tabular-nums">{fix.lat.toFixed(4)}</span>
          </div>
          <div className="flex justify-between border-b border-primary/15 pb-0.5">
            <span className="text-primary/60">LON</span>
            <span className="text-foreground/85 tabular-nums">{fix.lon.toFixed(4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-primary/60">ALTITUDE</span>
            <span className="text-foreground/85">{fix.altitude == null ? "—" : `${fix.altitude.toFixed(0)}m`}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-primary/60">HEADING</span>
            <span className="text-foreground/85">{fix.heading == null ? "—" : `${fix.heading.toFixed(0)}°`}</span>
          </div>
        </div>
      </HudPanel>

      <HudPanel
        index={1}
        title={`HOST SIGNATURE PINPOINTED // LAT: ${fix.lat.toFixed(4)} LON: ${fix.lon.toFixed(4)}`}
        className="flex flex-col"
      >
        <div className="relative h-[60vh] landscape:max-md:h-[58vh]">
          <div ref={mapEl} className="geo-map absolute inset-0" />
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <Crosshair />
            </div>
            <div className="absolute left-2 top-2 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              LIVE FEED // ORBITAL TILES // CARTO_DARK
            </div>
            <div className="absolute right-2 bottom-2 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              SCAN_RATE: 4.0Hz
            </div>
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

function Crosshair() {
  return (
    <div
      className="relative h-32 w-32 landscape:max-md:h-20 landscape:max-md:w-20"
      style={{ animation: "weather-sweep 6s linear infinite" }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-primary">
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.8" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.8" />
        <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.95" />
        <line x1="50" y1="0" x2="50" y2="22" stroke="currentColor" strokeWidth="0.6" />
        <line x1="50" y1="78" x2="50" y2="100" stroke="currentColor" strokeWidth="0.6" />
        <line x1="0" y1="50" x2="22" y2="50" stroke="currentColor" strokeWidth="0.6" />
        <line x1="78" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.6" />
        <circle cx="50" cy="50" r="2" fill="currentColor" />
      </svg>
    </div>
  );
}