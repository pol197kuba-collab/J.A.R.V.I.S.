import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { TacticalMap, type FlightStatus } from "@/components/jarvis/TacticalMap";
import { WeatherTelemetry } from "@/components/jarvis/WeatherTelemetry";
import { GithubActivityPulse } from "@/components/jarvis/GithubActivityPulse";
import { SystemPulseStream } from "@/components/jarvis/SystemPulseStream";

export const Route = createFileRoute("/situation-room")({
  head: () => ({
    meta: [
      { title: "JARVIS // Situation Room" },
      {
        name: "description",
        content:
          "Unified command radar — position, live system activity, weather and GitHub pulse.",
      },
      { property: "og:title", content: "JARVIS // Situation Room" },
      {
        property: "og:description",
        content:
          "Unified command radar — position, live system activity, weather and GitHub pulse.",
      },
    ],
  }),
  component: SituationRoomPage,
});

type Status = "acquiring" | "locked" | "fallback";

type Fix = {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  heading: number | null;
};

const FALLBACK: Fix = {
  lat: 52.2297,
  lon: 21.0122,
  accuracy: 9999,
  altitude: null,
  heading: null,
};

function SituationRoomPage() {
  const [fix, setFix] = useState<Fix>(FALLBACK);
  const [status, setStatus] = useState<Status>("acquiring");
  const [bootProgress, setBootProgress] = useState(0);
  // Aircraft now load based on the map's own current viewport (real ADS-B
  // via adsb.lol, owned by TacticalMap since it owns the Leaflet instance
  // the viewport comes from) — like a real flight tracker, not a fixed
  // radius around "home". This just reflects that status back into the
  // HUD readout above the map.
  const [flightStatus, setFlightStatus] = useState<FlightStatus>({ kind: "ok", count: 0 });

  // Boot / acquisition sequence — runs once
  useEffect(() => {
    let cancelled = false;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const p = Math.min(1, elapsed / 1800);
      setBootProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setFix({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
          });
          setTimeout(() => !cancelled && setStatus("locked"), 1800);
        },
        () => {
          if (cancelled) return;
          setTimeout(() => !cancelled && setStatus("fallback"), 1800);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 },
      );
    } else {
      setTimeout(() => !cancelled && setStatus("fallback"), 1800);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const isLoading = status === "acquiring";
  const signatureLabel =
    status === "acquiring"
      ? "● ACQUIRING…"
      : status === "locked"
        ? "● PINPOINTED"
        : "● FALLBACK GRID";

  return (
    <div className="space-y-3 p-3 landscape:max-md:space-y-2 landscape:max-md:p-2">
      <HudPanel
        index={0}
        title="SITUATION ROOM // ORBITAL UPLINK"
        className="p-3 landscape:max-md:p-2"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 font-display text-[10px] uppercase tracking-[0.2em] landscape:max-md:text-[9px]">
          <Row
            label="SIGNATURE"
            value={signatureLabel}
            valueClass={
              status === "locked"
                ? "text-[color:var(--success)]"
                : status === "fallback"
                  ? "text-[color:var(--warning,#f5a524)]"
                  : "text-primary"
            }
          />
          <Row
            label="ACCURACY"
            value={status === "acquiring" ? "—" : `±${Math.round(fix.accuracy)}m`}
          />
          <Row label="LAT" value={status === "acquiring" ? "--.----" : fix.lat.toFixed(4)} mono />
          <Row label="LON" value={status === "acquiring" ? "--.----" : fix.lon.toFixed(4)} mono />
          <Row
            label="ALTITUDE"
            value={fix.altitude == null ? "—" : `${fix.altitude.toFixed(0)}m`}
          />
          <Row label="HEADING" value={fix.heading == null ? "—" : `${fix.heading.toFixed(0)}°`} />
        </div>
      </HudPanel>

      <HudPanel
        index={1}
        title={
          status === "acquiring"
            ? "ACQUIRING SATELLITE LOCK…"
            : `HOST SIGNATURE ${status === "locked" ? "PINPOINTED" : "ESTIMATED"} // LAT: ${fix.lat.toFixed(4)} LON: ${fix.lon.toFixed(4)}`
        }
        className="flex flex-col"
      >
        <div className="relative h-[55vh] overflow-hidden bg-black landscape:max-md:h-[50vh]">
          <TacticalMap
            lat={fix.lat}
            lon={fix.lon}
            active={!isLoading}
            onStatusChange={setFlightStatus}
          />
          {isLoading ? <AcquireOverlay progress={bootProgress} /> : null}

          <div className="pointer-events-none absolute inset-0">
            <HudCorners />
            <div className="absolute left-3 top-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              LIVE FEED // STARK SAT-LINK // CH:
              {(Math.abs(fix.lat * 100) | 0).toString(16).toUpperCase().padStart(3, "0")}-
              {(Math.abs(fix.lon * 100) | 0).toString(16).toUpperCase().padStart(3, "0")}
            </div>
            <div
              className="absolute right-3 top-3 font-display text-[9px] uppercase tracking-[0.25em]"
              style={{
                color:
                  flightStatus.kind === "error"
                    ? "var(--destructive)"
                    : flightStatus.kind === "zoom_in"
                      ? "var(--warning)"
                      : "color-mix(in oklab, var(--primary) 70%, transparent)",
              }}
            >
              {flightStatus.kind === "error"
                ? "AIRCRAFT: UPLINK ERROR — SEE SYSTEM LOGS"
                : flightStatus.kind === "zoom_in"
                  ? "AIRCRAFT: ZOOM IN TO LOAD"
                  : `AIRCRAFT: ${flightStatus.count}`}
            </div>
            <div className="absolute left-3 bottom-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              GRID: MAP // MODE: ADS-B // SCOPE: VIEWPORT
            </div>
            <div className="absolute right-3 bottom-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              {status === "locked"
                ? "LOCK: STABLE"
                : status === "fallback"
                  ? "LOCK: DEGRADED"
                  : "LOCK: PENDING"}
            </div>
          </div>
        </div>
      </HudPanel>

      <div className="grid gap-3 lg:grid-cols-3 landscape:max-md:grid-cols-3 landscape:max-md:gap-2">
        <WeatherTelemetry index={2} lat={fix.lat} lon={fix.lon} />
        <GithubActivityPulse index={3} />
        <SystemPulseStream index={4} />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  mono,
}: {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between border-b border-primary/15 pb-0.5">
      <span className="text-primary/60">{label}</span>
      <span className={`${valueClass ?? "text-foreground/85"} ${mono ? "tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function HudCorners() {
  const c = "absolute h-4 w-4 border-primary/70";
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className={`${c} left-1 top-1 border-l border-t`} />
      <div className={`${c} right-1 top-1 border-r border-t`} />
      <div className={`${c} left-1 bottom-1 border-l border-b`} />
      <div className={`${c} right-1 bottom-1 border-r border-b`} />
    </div>
  );
}

function AcquireOverlay({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-[1px]">
      <div className="relative h-24 w-24">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full text-primary animate-spin"
          style={{ animationDuration: "2.4s" }}
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray={`${progress * 276} 276`}
            transform="rotate(-90 50 50)"
          />
          <circle
            cx="50"
            cy="50"
            r="32"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeDasharray="2 4"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-[11px] tracking-[0.2em] text-primary">
          {pct}%
        </div>
      </div>
      <div className="font-display text-[10px] uppercase tracking-[0.4em] text-primary/85">
        ACQUIRING ORBITAL UPLINK
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary/55">
        triangulating • cross-referencing nav-sats • locking signature
      </div>
    </div>
  );
}
