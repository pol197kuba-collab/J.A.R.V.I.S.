// Rok zmian dziennych w jednej kratce — od razu widać serie podwyżek,
// spokojne miesiące i pojedyncze skoki.
//
// Skala DYWERGENTNA: dwa kolory biegunowe i neutralna szarość w środku
// (nigdy barwa w punkcie zerowym — inaczej „bez zmiany" czytałoby się jak
// osobna kategoria). Wzrost jest czerwony, bo dla kupującego paliwo droższe
// to zła wiadomość; ten sam kod kolorystyczny co w kaflach i prognozie.
import { useMemo, useState } from "react";
import { dailyChangeGrid, type PricePoint } from "@/lib/fuel/analytics";
import { EmptyState, PanelHint } from "./chrome";
import { formatDatePl, formatSigned } from "./format";

const CELL = 10;
const GAP = 2;
const DAY_LABELS = ["Pn", "", "Śr", "", "Pt", "", "Nd"];

function cellColor(change: number | null, scale: number): string {
  if (change === null) return "color-mix(in oklab, var(--muted-foreground) 12%, transparent)";
  if (change === 0) return "color-mix(in oklab, var(--muted-foreground) 22%, transparent)";
  const intensity = Math.min(1, Math.abs(change) / scale);
  const hue = change > 0 ? "var(--destructive)" : "var(--success)";
  // 18% to próg widoczności na ciemnym tle — poniżej kratka gubi się w siatce.
  const pct = Math.round(18 + intensity * 72);
  return `color-mix(in oklab, ${hue} ${pct}%, transparent)`;
}

export function ChangeHeatmap({ points, label }: { points: PricePoint[]; label: string }) {
  const [hovered, setHovered] = useState<{ date: string; change: number | null } | null>(null);

  const { cells, weeks, scale, stats } = useMemo(() => {
    const grid = dailyChangeGrid(points, 53);
    const changes = grid.map((c) => c.change).filter((c): c is number => c !== null && c !== 0);
    const sorted = [...changes].map(Math.abs).sort((a, b) => a - b);
    // Skalę ustawia 90. percentyl, nie maksimum — jeden ekstremalny dzień
    // inaczej spłaszczyłby cały rok do jednego odcienia.
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 1;

    const ups = changes.filter((c) => c > 0).length;
    const downs = changes.filter((c) => c < 0).length;
    const biggest = changes.reduce((best, c) => (Math.abs(c) > Math.abs(best) ? c : best), 0);

    return {
      cells: grid,
      weeks: grid.length ? Math.max(...grid.map((c) => c.weekIndex)) + 1 : 0,
      scale: Math.max(1, p90),
      stats: { ups, downs, biggest, quiet: grid.length - changes.length },
    };
  }, [points]);

  if (cells.length === 0) return <EmptyState>Brak danych do heatmapy</EmptyState>;

  const width = weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="p-5 @max-[420px]:p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="font-mono text-[11px] text-muted-foreground">
          <span className="text-[color:var(--destructive)]">{stats.ups}</span> dni w górę ·{" "}
          <span className="text-[color:var(--success)]">{stats.downs}</span> dni w dół ·{" "}
          {stats.quiet} bez zmiany
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          największy skok:{" "}
          <span style={{ color: stats.biggest > 0 ? "var(--destructive)" : "var(--success)" }}>
            {formatSigned(stats.biggest)} PLN/m³
          </span>
        </p>
      </div>

      <div className="no-scrollbar mt-3 overflow-x-auto overflow-y-hidden">
        <div className="flex min-w-0 items-start gap-1.5">
          <div
            className="font-display flex shrink-0 flex-col text-[7px] uppercase tracking-wider text-muted-foreground"
            aria-hidden
          >
            {DAY_LABELS.map((d, i) => (
              <span key={i} style={{ height: CELL + GAP, lineHeight: `${CELL + GAP}px` }}>
                {d}
              </span>
            ))}
          </div>

          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Heatmapa dziennych zmian ceny (${label}) za ostatni rok: ${stats.ups} dni wzrostu, ${stats.downs} dni spadku`}
          >
            {cells.map((cell) => (
              <rect
                key={cell.date}
                x={cell.weekIndex * (CELL + GAP)}
                y={cell.dayIndex * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={cellColor(cell.change, scale)}
                onMouseEnter={() => setHovered({ date: cell.date, change: cell.change })}
                onMouseLeave={() => setHovered(null)}
              >
                <title>
                  {formatDatePl(cell.date)}:{" "}
                  {cell.change === null ? "brak danych" : `${formatSigned(cell.change)} PLN/m³`}
                </title>
              </rect>
            ))}
          </svg>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-display text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
          taniej
        </span>
        <div className="flex items-center gap-0.5" aria-hidden>
          {[-1, -0.5, 0, 0.5, 1].map((step) => (
            <span
              key={step}
              className="h-2.5 w-4 rounded-[2px]"
              style={{ background: cellColor(step * scale, scale) }}
            />
          ))}
        </div>
        <span className="font-display text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
          drożej
        </span>
        {hovered && (
          <span className="font-mono text-[10px] text-foreground/80">
            {formatDatePl(hovered.date)}:{" "}
            {hovered.change === null ? "brak danych" : `${formatSigned(hovered.change)} PLN/m³`}
          </span>
        )}
      </div>

      <PanelHint>
        Intensywność skalowana 90. percentylem zmian, żeby jeden ekstremalny dzień nie spłaszczył
        reszty roku. Puste kratki to dni bez notowania.
      </PanelHint>
    </div>
  );
}
