// Proste podsumowanie graczy funduszu: karta na gracza (co kupił, co
// sprzedał, co dało zysk, co stratę) i tabela instrument × gracz, żeby
// porównać wszystkich naraz. Liczby z src/lib/fund/summary.ts — panel tylko
// je mówi.

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { assetBySymbol } from "@/lib/markets/assets";
import type { FundPlayer, FundView } from "@/lib/fund/fund.functions";
import { compareBySymbol, type PlayerSummary } from "@/lib/fund/summary";
import { isWaiting, waitingFor } from "@/lib/fund/verdict";
import {
  KIND_BADGE,
  PLAYER_COLOR,
  PLAYER_SHORT,
  pctFmt,
  plnFmt,
  shortDate,
  signColor,
  zlCompact,
  zlFmt,
} from "./fundFormat";
import { Swatch } from "./Swatch";

const label = (symbol: string): string => assetBySymbol(symbol)?.label ?? symbol;

function Split({ name, value }: { name: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="font-display truncate text-[8px] uppercase tracking-widest text-muted-foreground">
        {name}
      </p>
      <p className="font-mono text-xs font-bold" style={{ color: signColor(value) }}>
        {zlFmt(value)}
      </p>
    </div>
  );
}

function PlayerCard({
  player,
  rank,
  summary,
  active,
  onSelect,
}: {
  player: FundPlayer;
  rank: number | null;
  summary: PlayerSummary | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const m = player.metrics;
  const waiting = isWaiting(player);
  const s = summary;
  const noTrades = !waiting && m !== null && m.trades === 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 border border-primary/15 px-3 py-3 text-left transition hover:bg-primary/5",
        active && "border-primary/45 bg-primary/10",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">
          {rank === null ? "–" : `${rank}.`}
        </span>
        <Swatch
          color={PLAYER_COLOR[player.key] ?? "var(--muted-foreground)"}
          dashed={player.kind !== "source"}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {player.label}
          {KIND_BADGE[player.kind] && (
            <span className="ml-2 font-display text-[8px] uppercase tracking-widest text-muted-foreground">
              {KIND_BADGE[player.kind]}
            </span>
          )}
        </span>
        <span
          className="shrink-0 font-mono text-base font-bold"
          style={{
            color: m && !waiting ? signColor(m.returnPct * 100) : "var(--muted-foreground)",
          }}
        >
          {m && !waiting ? pctFmt(m.returnPct) : "—"}
        </span>
      </span>

      {waiting ? (
        <span className="pl-6 text-[11px] leading-snug text-muted-foreground">
          Nie gra — czeka na {waitingFor(player.key)}, więc trzyma gotówkę.
        </span>
      ) : (
        <>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-6">
            <span
              className="font-mono text-sm font-bold"
              style={{ color: signColor(s?.totalPln ?? 0) }}
            >
              {zlFmt(s?.totalPln ?? player.navPln - 100_000)}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              wycena {plnFmt(player.navPln)} zł
            </span>
          </span>

          {noTrades ? (
            <span className="pl-6 text-[11px] leading-snug text-foreground/75">
              {m?.signals ?? 0} prognoz, 0 transakcji — żadna nie otworzyła pozycji (same „bez
              zmian”), więc cały czas trzyma gotówkę.
            </span>
          ) : (
            s && (
              <>
                <span className="pl-6 text-[11px] leading-snug text-foreground/85">
                  Kupił {s.buys}× za {plnFmt(s.boughtPln)} zł, sprzedał {s.sells}× za{" "}
                  {plnFmt(s.soldPln)} zł.{" "}
                  {s.closed > 0 ? (
                    <>
                      Na plusie{" "}
                      <span className="font-mono text-foreground">
                        {s.wins} z {s.closed}
                      </span>{" "}
                      zamkniętych.
                    </>
                  ) : (
                    "Nic jeszcze nie zamknął."
                  )}
                </span>
                <span className="grid grid-cols-3 gap-2 pl-6">
                  <Split name="zamknięte" value={s.realizedPln} />
                  <Split name="otwarte" value={s.unrealizedPln} />
                  <div className="min-w-0">
                    <p className="font-display truncate text-[8px] uppercase tracking-widest text-muted-foreground">
                      w tym prowizje
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {plnFmt(s.feesPln)} zł
                    </p>
                  </div>
                </span>
                {(s.best || s.worst) && (
                  <span className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-[11px]">
                    {s.best && (
                      <span className="flex min-w-0 items-center gap-1">
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                        <span className="text-foreground/85">{label(s.best.symbol)}</span>
                        <span className="font-mono text-success">{zlFmt(s.best.totalPln)}</span>
                      </span>
                    )}
                    {s.worst && (
                      <span className="flex min-w-0 items-center gap-1">
                        <ArrowDownRight
                          className="h-3.5 w-3.5 shrink-0 text-destructive"
                          aria-hidden
                        />
                        <span className="text-foreground/85">{label(s.worst.symbol)}</span>
                        <span className="font-mono text-destructive">
                          {zlFmt(s.worst.totalPln)}
                        </span>
                      </span>
                    )}
                  </span>
                )}
              </>
            )
          )}

          {s && m && (s.financingPln > 0.5 || m.exits) && (
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 font-mono text-[10px] text-muted-foreground">
              {s.financingPln > 0.5 && (
                <span>dźwignia i pożyczki −{plnFmt(s.financingPln)} zł</span>
              )}
              {m.exits && m.exits.stopLoss > 0 && <span>stop-loss {m.exits.stopLoss}×</span>}
              {m.exits && m.exits.takeProfit > 0 && <span>take-profit {m.exits.takeProfit}×</span>}
              {m.exits && m.exits.horizon > 0 && <span>koniec horyzontu {m.exits.horizon}×</span>}
              {m.exits && m.exits.marginCall > 0 && (
                <span className="text-destructive">margin call {m.exits.marginCall}×</span>
              )}
            </span>
          )}

          {m && (
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 font-mono text-[10px] text-muted-foreground">
              {player.kind === "source" && m.signals !== undefined && (
                <span>
                  {m.horizonDays ? `horyzont ${m.horizonDays} dni · ` : ""}
                  {m.signals} prognoz
                  {m.lastSignalOn ? ` · ostatnia ${shortDate(m.lastSignalOn)}` : ""}
                </span>
              )}
              <span>obsunięcie {pctFmt(m.maxDrawdownPct, 1)}</span>
              <span>Sharpe {m.sharpe === null ? "—" : plnFmt(m.sharpe, 2)}</span>
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function PlayerCards({
  view,
  ranked,
  selectedKey,
  onSelect,
}: {
  view: FundView;
  ranked: FundPlayer[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  let rank = 0;
  return (
    <div
      className="mt-4 grid gap-2 @min-[760px]:grid-cols-2"
      role="list"
      aria-label="Wyniki graczy"
    >
      {ranked.map((p) => {
        const waiting = isWaiting(p);
        if (!waiting) rank += 1;
        return (
          <div key={p.key} role="listitem" className="min-w-0">
            <PlayerCard
              player={p}
              rank={waiting ? null : rank}
              summary={view.summary?.[p.key]}
              active={selectedKey === p.key}
              onSelect={() => onSelect(p.key)}
            />
          </div>
        );
      })}
    </div>
  );
}

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
