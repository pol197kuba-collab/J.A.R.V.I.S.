// The instrument list beside the chart on /rynki: every instrument the module
// can follow, in category tabs (plus "Obserwowane"), each with its price and
// change of the day. A click puts it on the chart (no scrolling to a watchlist
// below the fold any more); the star adds it to / removes it from the
// watchlist. It scrolls inside itself, so it never pushes the chart away.

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPercent, formatPrice } from "@/lib/markets/series";
import type { AssetClass } from "@/lib/markets/assets";
import type { ListRow } from "./marketsDigest";

type Group = { cls: AssetClass; label: string; rows: ListRow[] };

const changeColor = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? "var(--muted-foreground)"
    : v > 0
      ? "var(--success)"
      : v < 0
        ? "var(--destructive)"
        : "var(--foreground)";

export function InstrumentList({
  groups,
  selected,
  onSelect,
  onToggleWatch,
  busySymbol,
}: {
  groups: Group[];
  selected: readonly string[];
  onSelect: (symbol: string) => void;
  onToggleWatch: (symbol: string, watched: boolean) => void;
  busySymbol: string | null;
}) {
  const [tab, setTab] = useState<"watched" | AssetClass>("watched");
  const watched = useMemo(() => groups.flatMap((g) => g.rows.filter((r) => r.watched)), [groups]);
  const rows = tab === "watched" ? watched : (groups.find((g) => g.cls === tab)?.rows ?? []);
  const tabs: Array<{ id: "watched" | AssetClass; label: string; count: number }> = [
    { id: "watched", label: "Obserwowane", count: watched.length },
    ...groups.map((g) => ({ id: g.cls, label: g.label, count: g.rows.length })),
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div
        role="tablist"
        aria-label="Kategorie instrumentów"
        className="no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden pb-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "font-display shrink-0 rounded px-2 py-1.5 text-[9px] uppercase tracking-[0.18em] transition-colors",
              tab === t.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1 text-muted-foreground/70">{t.count}</span>
          </button>
        ))}
      </div>

      {/* wide: a scrolling column beside the chart; narrow (phone): a strip of
          chips right above the chart, so picking and seeing stay on one screen */}
      <ul className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden @max-[899px]:flex @max-[899px]:gap-2 @max-[899px]:overflow-x-auto @max-[899px]:overflow-y-hidden">
        {rows.length === 0 && (
          <li className="px-1 py-6 text-center font-mono text-[11px] text-muted-foreground">
            {tab === "watched"
              ? "Nic nie obserwujesz — dodaj gwiazdką w kategoriach."
              : "Brak instrumentów."}
          </li>
        )}
        {rows.map((r) => {
          const on = selected.includes(r.symbol);
          return (
            <li key={r.symbol} className="relative @max-[899px]:w-[200px] @max-[899px]:shrink-0">
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 border-b border-primary/10 py-2 pr-1 pl-2 @max-[899px]:rounded @max-[899px]:border-b-0 @max-[899px]:bg-primary/[0.05]",
                  on && "bg-primary/10",
                )}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(r.symbol)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-6 w-0.5 shrink-0 rounded",
                      on ? "bg-primary" : "bg-transparent",
                    )}
                    style={on ? { boxShadow: "0 0 8px var(--primary)" } : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "font-display block truncate text-[11px] uppercase tracking-[0.14em]",
                        on ? "text-primary" : "text-foreground",
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-muted-foreground">
                      {r.symbol}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                    <span className="block text-foreground">
                      {r.last !== null && r.currency ? formatPrice(r.last, r.currency) : "—"}
                    </span>
                    <span className="block text-[10px]" style={{ color: changeColor(r.change1d) }}>
                      {formatPercent(r.change1d)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={
                    r.watched ? `Przestań obserwować: ${r.label}` : `Obserwuj: ${r.label}`
                  }
                  title={r.watched ? "Przestań obserwować" : "Obserwuj"}
                  disabled={busySymbol === r.symbol}
                  onClick={() => onToggleWatch(r.symbol, r.watched)}
                  className="shrink-0 rounded p-1.5 transition-colors hover:bg-primary/10 disabled:opacity-40"
                >
                  <Star
                    className="h-3.5 w-3.5"
                    strokeWidth={1.6}
                    style={{
                      color: r.watched ? "var(--reactor)" : "var(--muted-foreground)",
                      fill: r.watched ? "var(--reactor)" : "transparent",
                    }}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
