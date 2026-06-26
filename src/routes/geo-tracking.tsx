import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";

export const Route = createFileRoute("/geo-tracking")({
  head: () => ({
    meta: [
      { title: "JARVIS // Geo-Tracking" },
      { name: "description", content: "Stark tactical grid pinpointing the host signature." },
      { property: "og:title", content: "JARVIS // Geo-Tracking" },
      { property: "og:description", content: "Stark tactical grid pinpointing the host signature." },
    ],
  }),
  component: GeoTrackingPage,
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

function GeoTrackingPage() {
  const [fix, setFix] = useState<Fix>(FALLBACK);
  const [status, setStatus] = useState<Status>("acquiring");
  const [bootProgress, setBootProgress] = useState(0);

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

    // Try geolocation in parallel with the dramatic boot
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
      <HudPanel index={0} title="GEO-TRACKING // ORBITAL UPLINK" className="p-3 landscape:max-md:p-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 font-display text-[10px] uppercase tracking-[0.2em] landscape:max-md:text-[9px]">
          <Row label="SIGNATURE" value={signatureLabel} valueClass={status === "locked" ? "text-[color:var(--success)]" : status === "fallback" ? "text-[color:var(--warning,#f5a524)]" : "text-primary"} />
          <Row label="ACCURACY" value={status === "acquiring" ? "—" : `±${Math.round(fix.accuracy)}m`} />
          <Row label="LAT" value={status === "acquiring" ? "--.----" : fix.lat.toFixed(4)} mono />
          <Row label="LON" value={status === "acquiring" ? "--.----" : fix.lon.toFixed(4)} mono />
          <Row label="ALTITUDE" value={fix.altitude == null ? "—" : `${fix.altitude.toFixed(0)}m`} />
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
        <div className="relative h-[60vh] overflow-hidden bg-black landscape:max-md:h-[58vh]">
          <TacticalGrid lat={fix.lat} lon={fix.lon} active={!isLoading} />
          {isLoading ? <AcquireOverlay progress={bootProgress} /> : null}

          {/* Static HUD corners + readouts */}
          <HudCorners />
          <div className="pointer-events-none absolute left-3 top-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            LIVE FEED // STARK SAT-LINK // CH:{(Math.abs(fix.lat * 100) | 0).toString(16).toUpperCase().padStart(3, "0")}-{(Math.abs(fix.lon * 100) | 0).toString(16).toUpperCase().padStart(3, "0")}
          </div>
          <div className="pointer-events-none absolute right-3 top-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            SCAN_RATE: 4.0Hz
          </div>
          <div className="pointer-events-none absolute left-3 bottom-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            GRID: TACTICAL // MODE: SURVEILLANCE
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            {status === "locked" ? "LOCK: STABLE" : status === "fallback" ? "LOCK: DEGRADED" : "LOCK: PENDING"}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

function Row({ label, value, valueClass, mono }: { label: string; value: string; valueClass?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-primary/15 pb-0.5">
      <span className="text-primary/60">{label}</span>
      <span className={`${valueClass ?? "text-foreground/85"} ${mono ? "tabular-nums" : ""}`}>{value}</span>
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
        <svg viewBox="0 0 100 100" className="h-full w-full text-primary animate-spin" style={{ animationDuration: "2.4s" }}>
          <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
          <circle
            cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeDasharray={`${progress * 276} 276`}
            transform="rotate(-90 50 50)"
          />
          <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="2 4" />
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

function TacticalGrid({ lat, lon, active }: { lat: number; lon: number; active: boolean }) {
  // Deterministic decorative satellites/blips from coords
  const blips = useMemo(() => {
    const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1;
    const out: { x: number; y: number; r: number; d: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const s = (seed * (i + 1) * 17.31) % 1;
      const a = s * Math.PI * 2;
      const r = 12 + (i * 9) % 32;
      out.push({
        x: 50 + Math.cos(a) * r,
        y: 50 + Math.sin(a) * r,
        r: 0.9 + ((s * 7) % 1) * 0.9,
        d: i * 0.45,
      });
    }
    return out;
  }, [lat, lon]);

  return (
    <div className="absolute inset-0">
      {/* Layered grid background */}
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.10) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.18) 1px, transparent 1px)",
          backgroundSize: "176px 176px",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.95) 100%)",
        }}
      />
      {/* Scanlines */}
      <div
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(34,211,238,0.18) 0 1px, transparent 1px 4px)",
        }}
      />

      {/* Radar + rings + reticle (vector layer, scales to container) */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full text-primary"
      >
        {/* Range rings */}
        {[10, 20, 32, 44].map((r, i) => (
          <circle
            key={r}
            cx="50" cy="50" r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.18 + i * 0.06}
            strokeWidth="0.25"
            strokeDasharray={i % 2 ? "0.8 1.2" : undefined}
          />
        ))}
        {/* Axes */}
        <line x1="50" y1="2" x2="50" y2="98" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.2" />
        <line x1="2" y1="50" x2="98" y2="50" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.2" />
        {/* Compass marks */}
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const r1 = 46, r2 = i % 3 === 0 ? 43 : 44.5;
          return (
            <line
              key={i}
              x1={50 + Math.cos(a) * r1}
              y1={50 + Math.sin(a) * r1}
              x2={50 + Math.cos(a) * r2}
              y2={50 + Math.sin(a) * r2}
              stroke="currentColor"
              strokeOpacity="0.5"
              strokeWidth="0.2"
            />
          );
        })}
        {/* Cardinal letters */}
        {[
          { x: 50, y: 6, t: "N" },
          { x: 94, y: 52, t: "E" },
          { x: 50, y: 96, t: "S" },
          { x: 6, y: 52, t: "W" },
        ].map((c) => (
          <text
            key={c.t}
            x={c.x} y={c.y}
            textAnchor="middle"
            fontSize="3"
            fill="currentColor"
            fillOpacity="0.75"
            style={{ letterSpacing: "0.2em" }}
          >
            {c.t}
          </text>
        ))}

        {/* Decorative blips */}
        {active && blips.map((b, i) => (
          <g key={i} style={{ animation: `blip-fade 3.6s ${b.d}s ease-in-out infinite` }}>
            <circle cx={b.x} cy={b.y} r={b.r} fill="currentColor" fillOpacity="0.85" />
            <circle cx={b.x} cy={b.y} r={b.r * 3} fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.15" />
          </g>
        ))}

        {/* Sweep beam */}
        {active && (
          <g style={{ transformOrigin: "50px 50px", animation: "geo-sweep 5s linear infinite" }}>
            <defs>
              <linearGradient id="sweep" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
              </linearGradient>
            </defs>
            <path d="M50 50 L50 6 A44 44 0 0 1 89 32 Z" fill="url(#sweep)" />
          </g>
        )}

        {/* Target reticle */}
        <g>
          <circle cx="50" cy="50" r="6" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="3.4" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="0.6 0.8" />
          {active && (
            <circle cx="50" cy="50" r="1.6" fill="currentColor">
              <animate attributeName="r" values="1.4;2.4;1.4" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="fill-opacity" values="1;0.6;1" dur="1.6s" repeatCount="indefinite" />
            </circle>
          )}
          <line x1="50" y1="42" x2="50" y2="48" stroke="currentColor" strokeWidth="0.4" />
          <line x1="50" y1="52" x2="50" y2="58" stroke="currentColor" strokeWidth="0.4" />
          <line x1="42" y1="50" x2="48" y2="50" stroke="currentColor" strokeWidth="0.4" />
          <line x1="52" y1="50" x2="58" y2="50" stroke="currentColor" strokeWidth="0.4" />
        </g>
      </svg>

      {/* Lat/Lon ticker bars */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-10 font-display text-[8px] uppercase tracking-[0.3em] text-primary/40">
        <span>{lon.toFixed(2)}° W</span>
        <span>{lat.toFixed(2)}° N</span>
      </div>
    </div>
  );
}