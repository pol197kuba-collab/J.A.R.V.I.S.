// Lista paliw obok wykresu w /paliwa — ten sam układ co lista instrumentów
// w /rynki: nazwa, cena i zmiana dnia, klik = to paliwo na wykresie (i jako
// główne), oko = dołóż / zdejmij z wykresu. Na wąskim panelu (telefon) pasek
// kafelków tuż nad wykresem, żeby wybór i wykres były na jednym ekranie.

import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FuelSeries } from "@/lib/fuel/fuel.functions";
import { directionColor, formatPct, formatPln } from "./format";

export function FuelList({
  series,
  selectedId,
  visibleIds,
  onSelect,
  onToggleVisible,
}: {
  series: FuelSeries[];
  selectedId: number;
  visibleIds: number[];
  onSelect: (productId: number) => void;
  onToggleVisible: (productId: number) => void;
}) {
  return (
    <ul className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden @max-[899px]:flex @max-[899px]:gap-2 @max-[899px]:overflow-x-auto @max-[899px]:overflow-y-hidden">
      {series.length === 0 && (
        <li className="px-1 py-6 text-center font-mono text-[11px] text-muted-foreground">
          Brak notowań.
        </li>
      )}
      {series.map((fuel) => {
        const primary = fuel.productId === selectedId;
        const onChart = visibleIds.includes(fuel.productId);
        return (
          <li
            key={fuel.productId}
            className="relative @max-[899px]:w-[190px] @max-[899px]:shrink-0"
          >
            <div
              className={cn(
                "flex min-w-0 items-center gap-2 border-b border-primary/10 py-2.5 pr-1 pl-2 @max-[899px]:rounded @max-[899px]:border-b-0 @max-[899px]:bg-primary/[0.05]",
                primary && "bg-primary/10",
              )}
            >
              <button
                type="button"
                aria-pressed={primary}
                onClick={() => onSelect(fuel.productId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  aria-hidden
                  className="h-7 w-0.5 shrink-0 rounded"
                  style={{
                    background: onChart ? fuel.colorToken : "transparent",
                    boxShadow: onChart ? `0 0 8px ${fuel.colorToken}` : undefined,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "font-display block truncate text-[11px] uppercase tracking-[0.14em]",
                      primary ? "text-primary" : "text-foreground",
                    )}
                  >
                    {fuel.label}
                  </span>
                  <span className="block truncate font-mono text-[9px] text-muted-foreground">
                    {fuel.code} · PLN/m³
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                  <span className="block text-foreground">{formatPln(fuel.stats.latest)}</span>
                  <span
                    className="block text-[10px]"
                    style={{ color: directionColor(fuel.stats.changeDay) }}
                  >
                    {formatPct(fuel.stats.changeDayPct)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={
                  onChart ? `Zdejmij z wykresu: ${fuel.label}` : `Dołóż do wykresu: ${fuel.label}`
                }
                title={onChart ? "Zdejmij z wykresu" : "Dołóż do wykresu"}
                onClick={() => onToggleVisible(fuel.productId)}
                className="shrink-0 rounded p-1.5 transition-colors hover:bg-primary/10"
              >
                {onChart ? (
                  <Eye
                    className="h-3.5 w-3.5"
                    strokeWidth={1.6}
                    style={{ color: fuel.colorToken }}
                  />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
