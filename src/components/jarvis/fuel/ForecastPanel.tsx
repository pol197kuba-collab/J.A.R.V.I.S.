// Projekcja krótkoterminowa: dokąd zmierza cennik, jeśli trend z ostatnich
// 30 dni się utrzyma. Wstęga niepewności rośnie z horyzontem, bo taka jest
// prawda o takiej ekstrapolacji — wykres bez wstęgi sugerowałby pewność,
// której model nie ma.
import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { Forecast } from "@/lib/fuel/analytics";
import type { FuelSeries } from "@/lib/fuel/fuel.functions";
import { EmptyState, PanelHint, SeriesTooltip } from "./chrome";
import { formatPln, formatSigned } from "./format";

const DIRECTION_META = {
  up: { label: "W GÓRĘ", color: "var(--destructive)", Icon: ArrowUpRight },
  down: { label: "W DÓŁ", color: "var(--success)", Icon: ArrowDownRight },
  flat: { label: "BEZ ZMIAN", color: "var(--muted-foreground)", Icon: ArrowRight },
} as const;

function shortLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function ForecastPanel({
  forecast,
  fuel,
}: {
  forecast: Forecast | undefined;
  fuel: FuelSeries | undefined;
}) {
  const rows = useMemo(() => {
    if (!forecast || forecast.points.length === 0 || !fuel) return [];

    // Kilkanaście dni historii przed prognozą, żeby wstęga miała kontekst
    // i nie wisiała w próżni.
    const history = fuel.points.slice(-14).map((p) => ({
      label: shortLabel(p.date),
      actual: p.price,
      forecast: null as number | null,
      band: null as [number, number] | null,
    }));

    const last = history[history.length - 1];
    const projected = forecast.points.map((p) => ({
      label: shortLabel(p.date),
      actual: null as number | null,
      forecast: p.value,
      band: [p.lower, p.upper] as [number, number],
    }));

    // Punkt styku: ostatni fakt jest też pierwszym punktem prognozy, żeby
    // linia nie miała dziury między historią a projekcją.
    if (last) {
      last.forecast = last.actual;
      last.band = [last.actual ?? 0, last.actual ?? 0];
    }

    return [...history, ...projected];
  }, [forecast, fuel]);

  if (!forecast || rows.length === 0) {
    return <EmptyState>Za mało danych na prognozę</EmptyState>;
  }

  const meta = DIRECTION_META[forecast.direction];
  const horizon = forecast.points[forecast.points.length - 1];
  const delta =
    fuel?.stats.latest !== null && fuel?.stats.latest !== undefined
      ? horizon.value - fuel.stats.latest
      : null;

  return (
    <div className="p-5 @max-[420px]:p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <meta.Icon
            className="h-8 w-8 shrink-0"
            style={{ color: meta.color, filter: `drop-shadow(0 0 8px ${meta.color})` }}
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="min-w-0">
            <p
              className="font-display truncate text-2xl font-bold tracking-[0.1em]"
              style={{ color: meta.color }}
            >
              {meta.label}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              trend {formatSigned(forecast.slopePerDay, 1)} PLN/m³ dziennie
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            za {forecast.points.length} dni
          </p>
          <p className="font-display text-xl font-bold tabular-nums">
            {formatPln(horizon.value)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">PLN/m³</span>
          </p>
          <p className="font-mono text-[10px]" style={{ color: meta.color }}>
            {formatSigned(delta)} · widełki {formatPln(horizon.lower)}–{formatPln(horizon.upper)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            siła sygnału
          </p>
          <div className="mt-1.5 h-2 w-28 overflow-hidden rounded-full bg-primary/10">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${forecast.confidence}%`, background: meta.color }}
            />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">{forecast.confidence}%</p>
        </div>
      </div>

      <div
        className="mt-4 h-40 w-full"
        role="img"
        aria-label={`Prognoza ceny na ${forecast.points.length} dni: kierunek ${meta.label}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 8,
                fill: "var(--muted-foreground)",
                fontFamily: '"Share Tech Mono", monospace',
              }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              width={44}
              domain={["auto", "auto"]}
              tick={{
                fontSize: 8,
                fill: "var(--muted-foreground)",
                fontFamily: '"Share Tech Mono", monospace',
              }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatPln(v)}
            />
            <Tooltip
              content={<SeriesTooltip unit="PLN/m³" />}
              cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
            />

            <Area
              type="monotone"
              dataKey="band"
              name="Widełki"
              stroke="none"
              fill={meta.color}
              fillOpacity={0.14}
              connectNulls
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              name={fuel?.label ?? "Cena"}
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              connectNulls
              animationDuration={450}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Prognoza"
              stroke={meta.color}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              animationDuration={450}
            />
            {rows.length > forecast.points.length && (
              <ReferenceLine
                x={rows[rows.length - forecast.points.length - 1]?.label}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.4}
                strokeDasharray="2 3"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <PanelHint>
        Model statystyczny (regresja liniowa na 30 dniach + wstęga ±1σ reszt), nie rekomendacja
        zakupowa. Pionowa kreska oddziela fakty od projekcji.
      </PanelHint>
    </div>
  );
}
