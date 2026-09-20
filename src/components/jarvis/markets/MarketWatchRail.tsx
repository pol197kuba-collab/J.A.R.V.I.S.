// Lista obserwowanych instrumentów: cena, zmiana dzienna, miniwykres.
//
// Kafel jest przełącznikiem widoczności serii na wykresie (nie linkiem) —
// stąd aria-pressed zamiast roli linku. Usunięcie z watchlisty siedzi w
// osobnym przycisku wewnątrz kafla, żeby przypadkowe kliknięcie w wiersz
// niczego nie kasowało.
import { X } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { ASSET_CLASS_LABELS } from "@/lib/markets/assets";
import { formatPercent, formatPrice } from "@/lib/markets/series";
import type { MarketSeries } from "@/lib/markets/markets.functions";

const changeColor = (value: number | null): string => {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 0.005) {
    return "var(--muted-foreground)";
  }
  return value > 0 ? "var(--success)" : "var(--destructive)";
};

function Sparkline({ series }: { series: MarketSeries }) {
  const data = series.points.slice(-40).map((p) => ({ v: p.close }));
  if (data.length < 2) return <div className="h-8" />;
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          {/* Domena z danych, nie od zera — miniwykres pokazuje kształt ruchu,
              a nie wielkość bezwzględną. */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={series.colorToken}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarketWatchRail({
  series,
  visibleSymbols,
  onToggle,
  onRemove,
  removingSymbol,
}: {
  series: MarketSeries[];
  visibleSymbols: string[];
  onToggle: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  removingSymbol: string | null;
}) {
  return (
    <div className="mt-3 grid gap-2 @[560px]:grid-cols-2 @[900px]:grid-cols-3">
      {series.map((s) => {
        const active = visibleSymbols.includes(s.symbol);
        return (
          <div
            key={s.symbol}
            className={cn(
              "relative min-w-0 rounded border px-3 py-2 transition",
              active ? "border-primary/60 bg-primary/10" : "border-primary/20 hover:bg-primary/5",
            )}
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(s.symbol)}
              className="block w-full min-w-0 text-left"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.colorToken }}
                />
                <span className="font-display min-w-0 truncate text-[11px] uppercase tracking-widest text-foreground">
                  {s.label}
                </span>
                <span className="font-display ml-auto shrink-0 pr-5 text-[8px] uppercase tracking-widest text-muted-foreground">
                  {ASSET_CLASS_LABELS[s.assetClass]}
                </span>
              </div>

              <div className="mt-1 flex min-w-0 items-baseline gap-2">
                <span className="font-display min-w-0 truncate text-lg font-bold tracking-wide text-foreground">
                  {formatPrice(s.stats.last, s.currency)}
                </span>
                <span
                  className="ml-auto shrink-0 font-mono text-[11px] font-bold"
                  style={{ color: changeColor(s.stats.change1d) }}
                >
                  {formatPercent(s.stats.change1d)}
                </span>
              </div>

              <Sparkline series={s} />

              <div className="flex min-w-0 items-center justify-between gap-2 font-mono text-[9px] text-muted-foreground">
                <span className="truncate">
                  7D {formatPercent(s.stats.change7d)} · 30D {formatPercent(s.stats.change30d)}
                </span>
                <span className="shrink-0 uppercase">{s.source ?? "—"}</span>
              </div>
            </button>

            <button
              type="button"
              aria-label={`Usuń ${s.label} z obserwowanych`}
              disabled={removingSymbol === s.symbol}
              onClick={() => onRemove(s.symbol)}
              className="absolute top-2 right-2 rounded p-0.5 text-muted-foreground transition hover:bg-destructive/20 hover:text-foreground disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
