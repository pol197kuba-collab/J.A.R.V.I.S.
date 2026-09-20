// Pięć paliw jako małe wielokrotności: każdy kafel to osobny mini-wykres
// z własną etykietą i kolorem. Świadomie zamiast pięciu linii na jednym
// wykresie w roli domyślnej — serie różnią się poziomem o ponad 2000 PLN/m³,
// więc nałożone na siebie mówią o kształcie mniej niż osobne panele.
// (Nałożenie jest dostępne na żądanie, w trybie „Indeks 100".)
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { FuelSeries } from "@/lib/fuel/fuel.functions";
import { cn } from "@/lib/utils";
import { directionColor, formatPct, formatPln } from "./format";

function Sparkline({ series }: { series: FuelSeries }) {
  const data = series.points.slice(-60).map((p) => ({ v: p.price }));
  if (data.length < 2) return <div className="h-8" />;

  return (
    <div className="h-8" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${series.productId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.colorToken} stopOpacity={0.3} />
              <stop offset="100%" stopColor={series.colorToken} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={series.colorToken}
            strokeWidth={1.5}
            fill={`url(#spark-${series.productId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FuelProductRail({
  series,
  selectedId,
  onSelect,
  visibleIds,
  onToggleVisible,
}: {
  series: FuelSeries[];
  selectedId: number;
  onSelect: (productId: number) => void;
  visibleIds: number[];
  onToggleVisible: (productId: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-3 @max-[900px]:grid-cols-3 @max-[560px]:grid-cols-2 @max-[380px]:grid-cols-1">
      {series.map((fuel, index) => {
        const selected = fuel.productId === selectedId;
        const visible = visibleIds.includes(fuel.productId);
        const delta = fuel.stats.changeDay;

        return (
          <div
            key={fuel.productId}
            className={cn(
              "animate-hud-tile-in relative min-w-0 rounded-md border p-3 transition",
              selected ? "border-primary/60 bg-primary/5" : "border-primary/20 hover:bg-primary/5",
            )}
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <button
              type="button"
              onClick={() => onSelect(fuel.productId)}
              aria-pressed={selected}
              className="block w-full min-w-0 text-left"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: fuel.colorToken, boxShadow: `0 0 8px ${fuel.colorToken}` }}
                />
                <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  {fuel.label}
                </span>
              </span>

              <span className="font-display mt-1 block truncate text-xl font-bold tabular-nums">
                {formatPln(fuel.stats.latest)}
              </span>

              <span
                className="font-mono text-[10px] font-bold"
                style={{ color: directionColor(delta) }}
              >
                {formatPct(fuel.stats.changeDayPct)}
              </span>
            </button>

            <Sparkline series={fuel} />

            <button
              type="button"
              onClick={() => onToggleVisible(fuel.productId)}
              aria-pressed={visible}
              className={cn(
                "font-display mt-1 w-full rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.2em] transition",
                visible
                  ? "border-primary/40 text-primary"
                  : "border-primary/15 text-muted-foreground hover:bg-primary/10",
              )}
            >
              {visible ? "na wykresie" : "pokaż"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
