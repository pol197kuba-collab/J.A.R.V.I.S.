import { useMemo } from "react";

// Shared radar visual — extracted from the old geo-tracking page so
// Situation Room can reuse the same tactical grid, but with real contacts
// (system events) plotted on it instead of purely decorative blips derived
// from lat/lon.

export type RadarContact = {
  id: string;
  /** Compass bearing, 0 = North (up), clockwise. */
  angleDeg: number;
  /** 0 = center, 1 = outer ring. */
  distance: number;
  color: string;
  label?: string;
};

const RADAR_MAX_R = 44;

export function TacticalRadar({
  active,
  contacts,
  lat,
  lon,
}: {
  active: boolean;
  contacts: RadarContact[];
  lat: number;
  lon: number;
}) {
  const points = useMemo(
    () =>
      contacts.map((c) => {
        // angleDeg: 0 = North = pointing up (-y). SVG angle 0 points +x, so
        // shift by -90deg and convert to radians.
        const rad = ((c.angleDeg - 90) * Math.PI) / 180;
        const r = Math.max(0, Math.min(1, c.distance)) * RADAR_MAX_R;
        return {
          ...c,
          x: 50 + Math.cos(rad) * r,
          y: 50 + Math.sin(rad) * r,
        };
      }),
    [contacts],
  );

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
        {[10, 20, 32, RADAR_MAX_R].map((r, i) => (
          <circle
            key={r}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.18 + i * 0.06}
            strokeWidth="0.25"
            strokeDasharray={i % 2 ? "0.8 1.2" : undefined}
          />
        ))}
        {/* Axes */}
        <line
          x1="50"
          y1="2"
          x2="50"
          y2="98"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="0.2"
        />
        <line
          x1="2"
          y1="50"
          x2="98"
          y2="50"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="0.2"
        />
        {/* Compass marks */}
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const r1 = 46,
            r2 = i % 3 === 0 ? 43 : 44.5;
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
            x={c.x}
            y={c.y}
            textAnchor="middle"
            fontSize="3"
            fill="currentColor"
            fillOpacity="0.75"
            style={{ letterSpacing: "0.2em" }}
          >
            {c.t}
          </text>
        ))}

        {/* Real contacts — recent system_events plotted by recency/level */}
        {active &&
          points.map((p, i) => (
            <g key={p.id} style={{ animation: `blip-fade 3.6s ${i * 0.25}s ease-in-out infinite` }}>
              <title>{p.label}</title>
              <circle cx={p.x} cy={p.y} r={1.1} fill={p.color} fillOpacity="0.9" />
              <circle
                cx={p.x}
                cy={p.y}
                r={3.3}
                fill="none"
                stroke={p.color}
                strokeOpacity="0.4"
                strokeWidth="0.15"
              />
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
          <circle
            cx="50"
            cy="50"
            r="3.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.4"
            strokeDasharray="0.6 0.8"
          />
          {active && (
            <circle cx="50" cy="50" r="1.6" fill="currentColor">
              <animate attributeName="r" values="1.4;2.4;1.4" dur="1.6s" repeatCount="indefinite" />
              <animate
                attributeName="fill-opacity"
                values="1;0.6;1"
                dur="1.6s"
                repeatCount="indefinite"
              />
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
