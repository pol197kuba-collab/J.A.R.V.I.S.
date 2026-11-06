// Tabela instrument × gracz funduszu: zysk / strata w zł, żeby porównać
// wszystkich naraz. Liczby z src/lib/fund/summary.ts — panel tylko je mówi.
// (Karta pojedynczego gracza: FundPlayerSheet.tsx.)

import { useMemo } from "react";
import { assetBySymbol } from "@/lib/markets/assets";
import type { FundView } from "@/lib/fund/fund.functions";
import { compareBySymbol } from "@/lib/fund/summary";
import { isWaiting } from "@/lib/fund/verdict";
import { PLAYER_COLOR, PLAYER_SHORT, signColor, zlCompact } from "./fundFormat";
import { Swatch } from "./Swatch";

const label = (symbol: string): string => assetBySymbol(symbol)?.label ?? symbol;

/** Tabela instrument × gracz w zł (zamknięte + otwarte), plus wiersz „razem”. */
export function SymbolComparison({ view }: { view: FundView }) {
  const players = view.players.filter((p) => !isWaiting(p) && view.summary?.[p.key]);
  const rows = useMemo(
    () =>
      compareBySymbol(
        Object.fromEntries(players.map((p) => [p.key, view.summary[p.key]])),
        players.filter((p) => p.kind === "source").map((p) => p.key),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.summary, view.players],
  );
  if (players.length === 0 || rows.length === 0) {
    return <p className="font-mono text-[10px] text-muted-foreground">Brak transakcji.</p>;
  }
  const cols = {
    gridTemplateColumns: `minmax(0,1fr) repeat(${players.length}, minmax(0, var(--fund-col)))`,
  };
  return (
    <div className="min-w-0 text-[11px] [--fund-col:3.4rem] @max-[420px]:text-[10px] @max-[420px]:[--fund-col:2.7rem]">
      <div className="grid items-end gap-x-1.5 border-b border-primary/15 pb-1.5" style={cols}>
        <span className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
          Instrument
        </span>
        {players.map((p) => (
          <span key={p.key} className="flex min-w-0 flex-col items-end gap-1">
            <Swatch
              color={PLAYER_COLOR[p.key] ?? "var(--muted-foreground)"}
              dashed={p.kind !== "source"}
            />
            <span className="font-display w-full truncate text-right text-[8px] uppercase tracking-wider text-muted-foreground">
              {PLAYER_SHORT[p.key] ?? p.label}
            </span>
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div
          key={r.symbol}
          className="grid items-center gap-x-1.5 border-b border-primary/5 py-1.5"
          style={cols}
        >
          <span className="min-w-0 truncate text-foreground/85">{label(r.symbol)}</span>
          {players.map((p) => {
            const v = r.byPlayer[p.key];
            return (
              <span
                key={p.key}
                className="text-right font-mono"
                style={{ color: v === undefined ? "var(--muted-foreground)" : signColor(v) }}
              >
                {v === undefined ? "·" : zlCompact(v)}
              </span>
            );
          })}
        </div>
      ))}
      <div className="grid items-center gap-x-1.5 pt-2" style={cols}>
        <span className="font-display text-[9px] uppercase tracking-widest text-primary/80">
          Razem
        </span>
        {players.map((p) => {
          const v = view.summary[p.key].totalPln;
          return (
            <span
              key={p.key}
              className="text-right font-mono font-bold"
              style={{ color: signColor(v) }}
            >
              {zlCompact(v)}
            </span>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Wynik w zł na instrumencie: zamknięte transakcje (po prowizjach) + otwarte pozycje. Na górze
        instrumenty, na których agenci razem stracili najwięcej. „·” = gracz nim nie grał.
      </p>
    </div>
  );
}
