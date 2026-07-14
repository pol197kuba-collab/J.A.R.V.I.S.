import { useEffect, useState } from "react";
import { HudPanel } from "./HudPanel";

type Reading = {
  thermal: number;
  pressure: number;
  windDir: string;
  windSpeed: number;
  humidity: number;
  visibility: number;
  uv: number;
};

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function seed(): Reading {
  return {
    thermal: 24.2,
    pressure: 1014,
    windDir: "NW",
    windSpeed: 5.4,
    humidity: 48,
    visibility: 14.6,
    uv: 3,
  };
}

function jitter(prev: Reading): Reading {
  const drift = (cur: number, amp: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, cur + (Math.random() - 0.5) * amp));
  return {
    thermal: +drift(prev.thermal, 0.4, 18, 30).toFixed(1),
    pressure: Math.round(drift(prev.pressure, 1.4, 1005, 1022)),
    windDir: Math.random() > 0.85 ? DIRS[Math.floor(Math.random() * DIRS.length)] : prev.windDir,
    windSpeed: +drift(prev.windSpeed, 0.8, 1.2, 12).toFixed(1),
    humidity: Math.round(drift(prev.humidity, 2, 30, 78)),
    visibility: +drift(prev.visibility, 0.6, 6, 22).toFixed(1),
    uv: Math.max(0, Math.min(8, Math.round(drift(prev.uv, 0.6, 0, 8)))),
  };
}

export function WeatherTelemetry({ index = 0 }: { index?: number }) {
  const [r, setR] = useState<Reading>(seed());
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setR((p) => jitter(p));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const rows: Array<[string, string]> = [
    ["THERMAL_INDEX", `${r.thermal.toFixed(1)}°C`],
    ["ATMOSPHERIC_PRESSURE", `${r.pressure} hPa`],
    ["WIND_VECTOR", `${r.windDir} ${r.windSpeed.toFixed(1)} m/s`],
    ["HUMIDITY", `${r.humidity}%`],
    ["VISIBILITY", `${r.visibility.toFixed(1)} km`],
    ["UV_INDEX", `${r.uv}`],
  ];

  return (
    <HudPanel index={index} title="WEATHER // TELEMETRY GRID" className="flex flex-col">
      <div className="flex gap-3 p-3 landscape:max-md:gap-2 landscape:max-md:p-2">
        <ul className="flex-1 space-y-1 font-display text-[10px] uppercase tracking-[0.2em] text-foreground/85 landscape:max-md:text-[8px]">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2 border-b border-primary/10 pb-0.5">
              <span className="text-primary/60">{k}</span>
              <span className="text-[color:var(--success)] tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
        <WeatherRadar />
      </div>
    </HudPanel>
  );
}

function WeatherRadar() {
  return (
    <div className="relative aspect-square w-20 shrink-0 border border-[color:var(--success)]/40 bg-black/50 landscape:max-md:w-14">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-[color:var(--success)]">
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.5" />
        <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35" />
        <circle cx="50" cy="50" r="16" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35" />
        <line x1="2" y1="50" x2="98" y2="50" stroke="currentColor" strokeWidth="0.3" opacity="0.25" />
        <line x1="50" y1="2" x2="50" y2="98" stroke="currentColor" strokeWidth="0.3" opacity="0.25" />
      </svg>
      <div
        className="absolute inset-0 origin-center"
        style={{ animation: "weather-sweep 3.5s linear infinite" }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-1/2 w-1/2 origin-top-left"
          style={{
            background:
              "conic-gradient(from 0deg, oklch(0.78 0.18 160 / 0.55), oklch(0.78 0.18 160 / 0) 80deg)",
          }}
        />
      </div>
      <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--success)] shadow-[0_0_8px_var(--success)]" />
    </div>
  );
}