// Główny wykres modułu /rynki.
//
// JEDNA OŚ, zawsze. Bitcoin po ~80 000 USD i WIG20 po ~2 500 pkt nie mieszczą
// się na wspólnej skali cenowej, a druga oś po prawej pozwoliłaby „ustawić"
// dowolną korelację doborem zakresów — to najczęstszy błąd tego typu
// zestawień. Dlatego porównanie wielu instrumentów jest możliwe wyłącznie w
// trybie „Indeks 100" (wszystko przeskalowane do wspólnego startu), a tryb
// cenowy rysuje dokładnie jeden instrument w jego własnej walucie.
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { EmptyState } from "@/components/jarvis/fuel/chrome";
import { rebaseToHundred, type PricePoint } from "@/lib/markets/series";
import type { MarketSeries } from "@/lib/markets/markets.functions";

export type ChartMode = "price" | "index";

type Row = { label: string; date: string } & Record<string, number | string | null>;

const shortLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

/** Klucz serii w wierszu wykresu — symbole zawierają kropki, recharts nie lubi ich w dataKey. */
const keyFor = (symbol: string): string => `s_${symbol.replace(/[^A-Za-z0-9]/g, "_")}`;

function MarketTooltip({
  active,
  payload,
  label,
  mode,
  currencyByKey,
}: TooltipProps<number, string> & {
  mode: ChartMode;
  currencyByKey: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pointer-events-none rounded border border-primary/30 bg-popover px-2.5 py-1.5 shadow-lg">
      <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
        {String(label)}
      </p>
      <div className="mt-1 space-y-0.5">
        {payload.map((entry) => {
          const value = entry.value as number | null;
          const key = String(entry.dataKey);
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
                {entry.name}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] font-bold text-foreground">
                {value === null || value === undefined
                  ? "—"
                  : mode === "index"
                    ? value.toFixed(1)
                    : value.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}
                <span className="ml-1 text-[9px] text-muted-foreground">
                  {mode === "index" ? "pkt" : (currencyByKey[key] ?? "")}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MarketChart({
  series,
  visibleSymbols,
  mode,
}: {
  series: MarketSeries[];
  visibleSymbols: string[];
  mode: ChartMode;
}) {
  const visible = useMemo(
    () => series.filter((s) => visibleSymbols.includes(s.symbol)),
    [series, visibleSymbols],
  );

  const { rows, currencyByKey } = useMemo(() => {
    const byDate = new Map<string, Row>();
    const currencies: Record<string, string> = {};

    for (const s of visible) {
      const key = keyFor(s.symbol);
      currencies[key] = s.currency;
      const values: Array<{ date: string; value: number }> =
        mode === "index"
          ? rebaseToHundred(s.points)
          : s.points.map((p: PricePoint) => ({ date: p.date, value: p.close }));

      for (const point of values) {
        const row = byDate.get(point.date) ?? { label: shortLabel(point.date), date: point.date };
        row[key] = point.value;
        byDate.set(point.date, row);
      }
    }

    return {
      rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      currencyByKey: currencies,
    };
  }, [visible, mode]);

  if (visible.length === 0 || rows.length === 0) {
    return <EmptyState>Wybierz instrument z listy obserwowanych</EmptyState>;
  }

  // Obszar pod linią tylko dla pojedynczej serii — przy kilku nakładające się
  // wypełnienia zamazują przebiegi zamiast cokolwiek dodawać.
  const single = visible.length === 1;

  return (
    <div className="mt-3 h-[320px] w-full @max-[520px]:h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="marketAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={visible[0].colorToken} stopOpacity={0.28} />
              <stop offset="100%" stopColor={visible[0].colorToken} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--primary)" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            width={56}
            domain={["auto", "auto"]}
            tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) =>
              mode === "index"
                ? v.toFixed(0)
                : v.toLocaleString("pl-PL", { maximumFractionDigits: 2 })
            }
          />
          <Tooltip
            content={<MarketTooltip mode={mode} currencyByKey={currencyByKey} />}
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
          />
          {/* Legenda zawsze przy dwóch i więcej seriach — tożsamość instrumentu
              nie może zależeć wyłącznie od koloru. */}
          {visible.length > 1 && (
            <Legend
              verticalAlign="top"
              height={24}
              wrapperStyle={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--muted-foreground)",
              }}
            />
          )}

          {single && (
            <Area
              type="monotone"
              dataKey={keyFor(visible[0].symbol)}
              name={visible[0].label}
              stroke={visible[0].colorToken}
              strokeWidth={2}
              fill="url(#marketAreaFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              animationDuration={450}
            />
          )}

          {!single &&
            visible.map((s) => (
              <Line
                key={s.symbol}
                type="monotone"
                dataKey={keyFor(s.symbol)}
                name={s.label}
                stroke={s.colorToken}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
                animationDuration={450}
              />
            ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
