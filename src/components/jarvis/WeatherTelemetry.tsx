import { useQuery } from "@tanstack/react-query";
import { HudPanel } from "./HudPanel";

// Real weather from Open-Meteo (free, no API key) using whatever
// coordinates the caller has — Situation Room passes the real geolocation
// fix it already acquired. Previously this panel showed randomly-jittered
// fake numbers; this is the honest replacement.

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
function degToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

type WeatherReading = {
  temperature: number;
  pressure: number;
  windDir: string;
  windSpeed: number;
  humidity: number;
};

async function fetchWeather(lat: number, lon: number): Promise<WeatherReading> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`open-meteo_http_${res.status}`);
  const data = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      surface_pressure?: number;
      wind_speed_10m?: number;
      wind_direction_10m?: number;
    };
  };
  const c = data.current ?? {};
  return {
    temperature: c.temperature_2m ?? 0,
    pressure: Math.round(c.surface_pressure ?? 0),
    windDir: degToCompass(c.wind_direction_10m ?? 0),
    windSpeed: c.wind_speed_10m ?? 0,
    humidity: Math.round(c.relative_humidity_2m ?? 0),
  };
}

export function WeatherTelemetry({
  index = 0,
  lat,
  lon,
}: {
  index?: number;
  lat: number;
  lon: number;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["weather", lat.toFixed(2), lon.toFixed(2)],
    queryFn: () => fetchWeather(lat, lon),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  const rows: Array<[string, string]> = data
    ? [
        ["TEMPERATURE", `${data.temperature.toFixed(1)}°C`],
        ["PRESSURE", `${data.pressure} hPa`],
        ["WIND_VECTOR", `${data.windDir} ${data.windSpeed.toFixed(1)} km/h`],
        ["HUMIDITY", `${data.humidity}%`],
      ]
    : [];

  return (
    <HudPanel
      index={index}
      tone="quiet"
      title="WEATHER // LIVE (OPEN-METEO)"
      className="flex flex-col"
    >
      <div className="flex gap-3 p-3 landscape:max-md:gap-2 landscape:max-md:p-2">
        {isLoading && (
          <p className="flex-1 font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            ▸ acquiring telemetry…
          </p>
        )}
        {error && !isLoading && (
          <p
            className="flex-1 font-display text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--destructive)" }}
          >
            ✕ weather uplink unreachable
          </p>
        )}
        {data && (
          <ul className="flex-1 space-y-1 font-display text-[10px] uppercase tracking-[0.2em] text-foreground/85 landscape:max-md:text-[8px]">
            {rows.map(([k, v]) => (
              <li
                key={k}
                className="flex items-center justify-between gap-2 border-b border-primary/10 pb-0.5"
              >
                <span className="text-primary/60">{k}</span>
                <span className="text-[color:var(--success)] tabular-nums">{v}</span>
              </li>
            ))}
          </ul>
        )}
        <WeatherRadar />
      </div>
    </HudPanel>
  );
}

function WeatherRadar() {
  return (
    <div className="relative aspect-square w-20 shrink-0 border border-[color:var(--success)]/40 bg-black/50 landscape:max-md:w-14">
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full text-[color:var(--success)]"
      >
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          opacity="0.5"
        />
        <circle
          cx="50"
          cy="50"
          r="32"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
          opacity="0.35"
        />
        <circle
          cx="50"
          cy="50"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.4"
          opacity="0.35"
        />
        <line
          x1="2"
          y1="50"
          x2="98"
          y2="50"
          stroke="currentColor"
          strokeWidth="0.3"
          opacity="0.25"
        />
        <line
          x1="50"
          y1="2"
          x2="50"
          y2="98"
          stroke="currentColor"
          strokeWidth="0.3"
          opacity="0.25"
        />
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
