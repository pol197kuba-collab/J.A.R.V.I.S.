// Główny wykres modułu: cennik hurtowy w czasie, z opcjonalnym porównaniem
// paliw i nałożoną ropą Brent.
//
// Brent jest przeliczany na PLN/m³ (src/lib/fuel/market.ts), więc wszystkie
// serie dzielą JEDNĄ oś — świadomie, zamiast drugiej osi po prawej: wykres
// o dwóch skalach pozwala „ustawić" dowolną korelację przez dobór zakresów
// i jest najczęstszym błędem tego typu zestawień. Tryb „Indeks 100" i
// „Spread" rozwiązują to samo pytanie bez oszukiwania oka.
import { useMemo } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RibbonChart3D } from "@/components/jarvis/charts3d/RibbonChart3D";
import { useRouteTransition } from "@/components/jarvis/TransitionContext";
import { indexTo100 } from "@/lib/fuel/analytics";
import type { FuelSeries, MarketOverlay } from "@/lib/fuel/fuel.functions";
import { EmptyState, SeriesTooltip } from "./chrome";
import { formatPln } from "./format";

export type ChartMode = "pln" | "index" | "spread";

const BRENT_KEY = "brent";
const BRENT_COLOR = "var(--muted-foreground)";
const BRENT_LABEL = "Brent w PLN";
/** Najwięcej punktów na wstęgę 3D — „MAX” (od 2004) to kilka tysięcy dni. */
const RIBBON_MAX_POINTS = 600;

type Row = { label: string } & Record<string, number | string | null>;

function shortLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function FuelPriceChart({
  series,
  visibleIds,
  primaryId,
  mode,
  overlay,
  showBrent,
}: {
  series: FuelSeries[];
  visibleIds: number[];
  primaryId: number;
  mode: ChartMode;
  overlay: MarketOverlay | undefined;
  showBrent: boolean;
}) {
  const visible = useMemo(
    () => series.filter((s) => visibleIds.includes(s.productId) && s.points.length > 0),
    [series, visibleIds],
  );

  const brentByDate = useMemo(
    () => new Map((overlay?.points ?? []).map((p) => [p.date, p.brentPlnPerM3])),
    [overlay],
  );

  const { rows, keys } = useMemo(() => {
    if (visible.length === 0) return { rows: [] as Row[], keys: [] as string[] };

    // Oś czasu = suma dni wszystkich widocznych serii, żeby żadna nie urwała
    // się w miejscu, gdzie inna ma lukę.
    const dates = [...new Set(visible.flatMap((s) => s.points.map((p) => p.date)))].sort();

    const valuesByKey = new Map<string, Array<number | null>>();
    for (const s of visible) {
      const byDate = new Map(s.points.map((p) => [p.date, p.price]));
      const raw = dates.map((d) => byDate.get(d) ?? null);
      valuesByKey.set(`p${s.productId}`, raw);
    }

    if (showBrent && brentByDate.size > 0) {
      valuesByKey.set(
        BRENT_KEY,
        dates.map((d) => brentByDate.get(d) ?? null),
      );
    }

    // Transformacja trybu działa na gotowych seriach — dzięki temu „indeks
    // 100" i „spread" liczą się z tych samych danych, które widać w trybie
    // PLN, a nie z osobnej ścieżki.
    const transformed = new Map<string, Array<number | null>>();
    for (const [key, values] of valuesByKey) {
      if (mode === "index") {
        const filled = values.map((v) => v ?? 0);
        const indexed = indexTo100(filled);
        transformed.set(
          key,
          values.map((v, i) => (v === null ? null : indexed[i])),
        );
      } else if (mode === "spread" && key !== BRENT_KEY) {
        transformed.set(
          key,
          values.map((v, i) => {
            const brent = brentByDate.get(dates[i]);
            return v === null || brent === undefined ? null : Math.round((v - brent) * 100) / 100;
          }),
        );
      } else {
        transformed.set(key, values);
      }
    }
    if (mode === "spread") transformed.delete(BRENT_KEY);

    const builtRows: Row[] = dates.map((date, i) => {
      const row: Row = { label: shortLabel(date), date };
      for (const [key, values] of transformed) row[key] = values[i];
      return row;
    });

    return { rows: builtRows, keys: [...transformed.keys()] };
  }, [visible, showBrent, brentByDate, mode]);

  const { can3d } = useRouteTransition();
  // 3D (jak w /rynki): te same serie po transformacji trybu, przerzedzone
  // równym krokiem — kształt zostaje, wstęga nie dźwiga tysięcy punktów.
  const ribbon = useMemo(() => {
    const step = Math.max(1, Math.ceil(rows.length / RIBBON_MAX_POINTS));
    const sampled = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    const byId = new Map(visible.map((s) => [`p${s.productId}`, s]));
    return {
      sampled,
      data: {
        rows: sampled.length,
        stacked: keys.length > 1,
        dateLabel: (i: number) => String(sampled[i]?.label ?? ""),
        formatY: (v: number) =>
          mode === "index" ? v.toFixed(0) : v.toLocaleString("pl-PL", { maximumFractionDigits: 0 }),
        series: keys.map((key) => {
          const points: Array<{ i: number; v: number }> = [];
          sampled.forEach((r, i) => {
            const v = r[key];
            if (typeof v === "number") points.push({ i, v });
          });
          return { key, color: byId.get(key)?.colorToken ?? BRENT_COLOR, points };
        }),
      },
      labelOf: (key: string) => byId.get(key)?.label ?? BRENT_LABEL,
      colorOf: (key: string) => byId.get(key)?.colorToken ?? BRENT_COLOR,
    };
  }, [rows, keys, visible, mode]);

  if (rows.length === 0) {
    return <EmptyState>Brak danych w wybranym zakresie</EmptyState>;
  }

  if (can3d) {
    const unit3d = mode === "index" ? "pkt" : "PLN/m³";
    return (
      <RibbonChart3D
        className="h-[440px] w-full @max-[520px]:h-[320px]"
        data={ribbon.data}
        fallback={null}
        tooltip={(i) => {
          const row = ribbon.sampled[i];
          if (!row) return null;
          return (
            <div className="font-display text-center text-[10px] uppercase tracking-[0.16em] text-foreground [text-shadow:0_0_10px_black,0_0_14px_var(--reactor)]">
              {keys.map((key) => {
                const v = row[key];
                if (typeof v !== "number") return null;
                return (
                  <b
                    key={key}
                    className="block text-[15px] font-normal tracking-[0.06em]"
                    style={{ color: ribbon.colorOf(key) }}
                  >
                    {mode === "index"
                      ? v.toFixed(1)
                      : v.toLocaleString("pl-PL", { maximumFractionDigits: 0 })}{" "}
                    <span className="text-[9px] text-muted-foreground">
                      {unit3d} · {ribbon.labelOf(key)}
                    </span>
                  </b>
                );
              })}
              {new Date(`${String(row.date)}T00:00:00`).toLocaleDateString("pl-PL")}
            </div>
          );
        }}
      />
    );
  }

  const unit = mode === "index" ? "" : "PLN/m³";
  const fractionDigits = mode === "index" ? 1 : 0;
  const primary = visible.find((s) => s.productId === primaryId) ?? visible[0];
  const primaryKey = `p${primary.productId}`;
  const showArea = mode !== "index" && keys.length <= 2;

  // Linie ekstremów tylko dla pojedynczej serii — przy kilku paliwach naraz
  // „max 52T" nie miałoby jednoznacznego właściciela.
  const highlight =
    mode === "pln" &&
    visible.length === 1 &&
    primary.stats.high52w !== null &&
    primary.stats.low52w !== null
      ? { high: primary.stats.high52w, low: primary.stats.low52w }
      : null;

  return (
    <div
      className="h-72 w-full @max-[520px]:h-56"
      role="img"
      aria-label={`Wykres cen hurtowych: ${visible.map((s) => s.label).join(", ")}${
        showBrent && mode !== "spread" ? `, ${BRENT_LABEL}` : ""
      }`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fuelAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary.colorToken} stopOpacity={0.35} />
              <stop offset="100%" stopColor={primary.colorToken} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="var(--muted-foreground)" strokeOpacity={0.12} />
          <XAxis
            dataKey="label"
            tick={{
              fontSize: 8,
              fill: "var(--muted-foreground)",
              fontFamily: '"Share Tech Mono", monospace',
            }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
          />
          <YAxis
            width={48}
            domain={["auto", "auto"]}
            tick={{
              fontSize: 8,
              fill: "var(--muted-foreground)",
              fontFamily: '"Share Tech Mono", monospace',
            }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatPln(value, fractionDigits)}
          />

          {highlight && (
            <>
              <ReferenceLine
                y={highlight.high}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 4"
                strokeOpacity={0.45}
                label={{
                  value: `max 52T ${formatPln(highlight.high)}`,
                  position: "insideTopRight",
                  fill: "var(--muted-foreground)",
                  fontSize: 8,
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              />
              <ReferenceLine
                y={highlight.low}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 4"
                strokeOpacity={0.45}
                label={{
                  value: `min 52T ${formatPln(highlight.low)}`,
                  position: "insideBottomRight",
                  fill: "var(--muted-foreground)",
                  fontSize: 8,
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              />
            </>
          )}

          <Tooltip
            content={<SeriesTooltip unit={unit} fractionDigits={fractionDigits} />}
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
          />

          {showArea && (
            <Area
              type="monotone"
              dataKey={primaryKey}
              name={primary.label}
              stroke={primary.colorToken}
              strokeWidth={2}
              fill="url(#fuelAreaFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              animationDuration={450}
              isAnimationActive
            />
          )}

          {keys
            .filter((key) => !(showArea && key === primaryKey))
            .map((key) => {
              const fuel = visible.find((s) => `p${s.productId}` === key);
              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={fuel ? fuel.label : BRENT_LABEL}
                  stroke={fuel ? fuel.colorToken : BRENT_COLOR}
                  strokeWidth={2}
                  strokeDasharray={fuel ? undefined : "5 4"}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls
                  animationDuration={450}
                />
              );
            })}

          {rows.length > 60 && (
            <Brush
              dataKey="label"
              height={18}
              travellerWidth={8}
              stroke="var(--primary)"
              fill="transparent"
              tickFormatter={() => ""}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Legenda żyje poza SVG, bo przy dwóch i więcej seriach musi być zawsze
 * widoczna (tożsamość serii nie może zależeć wyłącznie od koloru), a
 * recharts-owa legenda nie umie zawijać się sensownie w wąskim panelu.
 */
export function FuelChartLegend({
  series,
  visibleIds,
  showBrent,
  mode,
}: {
  series: FuelSeries[];
  visibleIds: number[];
  showBrent: boolean;
  mode: ChartMode;
}) {
  const entries: Array<{ key: string; label: string; color: string; dashed?: boolean }> = series
    .filter((s) => visibleIds.includes(s.productId))
    .map((s) => ({ key: String(s.productId), label: s.label, color: s.colorToken }));

  if (showBrent && mode !== "spread") {
    entries.push({ key: BRENT_KEY, label: BRENT_LABEL, color: BRENT_COLOR, dashed: true });
  }
  if (entries.length < 2) return null;

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {entries.map((entry) => (
        <li key={entry.key} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-4 shrink-0 rounded-full"
            style={{
              background: entry.dashed
                ? `repeating-linear-gradient(90deg, ${entry.color} 0 4px, transparent 4px 7px)`
                : entry.color,
            }}
          />
          <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {entry.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
