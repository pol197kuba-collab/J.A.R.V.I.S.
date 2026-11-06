// Karta gracza funduszu (/rynki): klik w gracza w rankingu. Analitycznie, ale
// po ludzku: wynik, portfel teraz (z zyskiem/stratą i kierunkiem dnia),
// historia pozycji — co kupił, kiedy, po ile, kiedy sprzedał i ile na tym
// zarobił — a pełna lista transakcji zwinięta na końcu.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import { formatPrice } from "@/lib/markets/series";
import {
  getFundPlayer,
  type FundHolding,
  type FundPlayer,
  type FundTrade,
} from "@/lib/fund/fund.functions";
import { episodes, type Episode } from "@/lib/fund/history";
import { describeSettings, settingsFor, type FundSettings } from "@/lib/fund/settings";
import type { PlayerSummary } from "@/lib/fund/summary";
import { isWaiting } from "@/lib/fund/verdict";
import { Fold } from "./Fold";
import { PLAYER_COLOR, pctFmt, plnFmt, shortDate, signColor, zlFmt } from "./fundFormat";
import { Swatch } from "./Swatch";

const name = (symbol: string) => assetBySymbol(symbol)?.label ?? symbol;
const price = (symbol: string, v: number | null) => {
  if (v === null || !Number.isFinite(v)) return "—";
  const cur = assetBySymbol(symbol)?.currency;
  return cur ? formatPrice(v, cur) : plnFmt(v, 2);
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display mt-6 text-[9px] uppercase tracking-[0.25em] text-primary/70">
      {children}
    </p>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display truncate text-[8px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className="font-mono text-[13px] font-bold"
        style={{ color: color ?? "var(--foreground)" }}
      >
        {value}
      </p>
    </div>
  );
}

function Trend({ change }: { change: number | null }) {
  if (change === null) return <span className="w-14 shrink-0" />;
  const Icon = change > 0.05 ? ArrowUpRight : change < -0.05 ? ArrowDownRight : Minus;
  const color =
    change > 0.05
      ? "var(--success)"
      : change < -0.05
        ? "var(--destructive)"
        : "var(--muted-foreground)";
  return (
    <span
      className="flex w-14 shrink-0 items-center justify-end gap-0.5 font-mono text-[10px]"
      style={{ color }}
      title="Zmiana ceny instrumentu w ostatniej sesji"
    >
      <Icon className="h-3 w-3" aria-hidden />
      {pctFmt(change, 1)}
    </span>
  );
}

function HoldingRow({ h }: { h: FundHolding }) {
  const short = h.units < 0;
  const pl = h.valuePln - h.costPln;
  const plPct = h.costPln !== 0 ? (pl / Math.abs(h.costPln)) * 100 : null;
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-primary/10 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground">
          {name(h.symbol)}
          <span className="ml-1.5 font-display text-[8px] uppercase tracking-widest text-muted-foreground">
            {short ? "na spadek" : "na wzrost"}
          </span>
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {plnFmt(Math.abs(h.units), Math.abs(h.units) < 10 ? 4 : 0)} szt. · teraz{" "}
          {price(h.symbol, h.last)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[11px] text-foreground">{plnFmt(Math.abs(h.valuePln))} zł</p>
        <p className="font-mono text-[10px]" style={{ color: signColor(pl) }}>
          {zlFmt(pl)}
          {plPct !== null && ` · ${pctFmt(plPct, 1)}`}
        </p>
      </div>
      <Trend change={h.change1d} />
    </li>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  const closed = e.closedOn !== null;
  return (
    <li className="min-w-0 border-b border-primary/10 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        {e.side === "long" ? (
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-success" aria-hidden />
        ) : (
          <ArrowDownRight
            className="h-3.5 w-3.5 shrink-0 self-center text-destructive"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {e.side === "long" ? "Kupno" : "Krótka sprzedaż"} · {name(e.symbol)}
        </span>
        <span
          className="shrink-0 font-mono text-[11px] font-bold"
          style={{ color: closed ? signColor(e.realizedPln) : "var(--muted-foreground)" }}
        >
          {closed ? zlFmt(e.realizedPln) : "otwarta"}
        </span>
      </div>
      <p className="mt-0.5 pl-5 font-mono text-[10px] text-muted-foreground">
        {shortDate(e.openedOn)} po {price(e.symbol, e.entryPrice)} ({plnFmt(e.entryPln)} zł)
        {closed
          ? ` → ${shortDate(e.closedOn!)} po ${price(e.symbol, e.exitPrice)}`
          : e.exitPrice !== null
            ? ` · częściowo zamknięta po ${price(e.symbol, e.exitPrice)}, ${zlFmt(e.realizedPln)}`
            : ""}
        {closed && e.returnPct !== null && ` · ${pctFmt(e.returnPct, 1)}`}
      </p>
      {e.reason && (
        <p className="mt-0.5 line-clamp-2 min-w-0 break-words pl-5 text-[11px] leading-snug text-foreground/65">
          {e.reason}
        </p>
      )}
    </li>
  );
}

function TradeRow({ t }: { t: FundTrade }) {
  const closing = t.realizedPln !== null;
  const action =
    t.side === "buy" ? (closing ? "Odkup" : "Kupno") : closing ? "Sprzedaż" : "Krótka sprzedaż";
  return (
    <li className="flex min-w-0 items-baseline gap-2 border-b border-primary/10 py-1.5 text-[11px]">
      <span className="w-11 shrink-0 font-mono text-[10px] text-muted-foreground">
        {shortDate(t.executedOn)}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {action} {name(t.symbol)}
        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
          {plnFmt(t.units, t.units < 10 ? 4 : 0)} × {price(t.symbol, t.price)}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[10px] text-foreground/80">
        {plnFmt(t.notionalPln)} zł
      </span>
      {closing && (
        <span
          className="w-16 shrink-0 text-right font-mono text-[10px]"
          style={{ color: signColor(t.realizedPln ?? 0) }}
        >
          {zlFmt(t.realizedPln ?? 0)}
        </span>
      )}
    </li>
  );
}

export function FundPlayerSheet({
  player,
  summary,
  settings,
  onOpenChange,
}: {
  player: FundPlayer | null;
  summary: PlayerSummary | undefined;
  settings: FundSettings | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const fetchPlayer = useServerFn(getFundPlayer);
  const detail = useQuery({
    queryKey: ["fund-player", player?.key],
    queryFn: () => fetchPlayer({ data: { player: player!.key } }),
    enabled: Boolean(player),
    staleTime: 60_000,
  });
  const history = useMemo(() => episodes(detail.data?.trades ?? []), [detail.data]);
  const closed = history.filter((e) => e.closedOn !== null);
  const wins = closed.filter((e) => e.realizedPln > 0).length;

  const m = player?.metrics ?? null;
  const waiting = player ? isWaiting(player) : false;
  const rules =
    player?.kind === "source" && settings
      ? describeSettings(settingsFor(settings, player.key))
      : "zasady domyślne — punkt odniesienia";

  return (
    <Sheet open={player !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="no-scrollbar w-full overflow-y-auto overflow-x-hidden sm:max-w-lg"
      >
        {player && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display flex items-center gap-2 text-[12px] uppercase tracking-[0.3em] text-primary">
                <Swatch
                  color={PLAYER_COLOR[player.key] ?? "var(--muted-foreground)"}
                  dashed={player.kind !== "source"}
                />
                {player.label}
              </SheetTitle>
              <SheetDescription className="text-[11px]">{rules}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat
                label="Wynik"
                value={m && !waiting ? pctFmt(m.returnPct) : "—"}
                color={m && !waiting ? signColor(m.returnPct * 100) : undefined}
              />
              <Stat
                label="W złotówkach"
                value={zlFmt(summary?.totalPln ?? player.navPln - 100_000)}
                color={signColor(summary?.totalPln ?? player.navPln - 100_000)}
              />
              <Stat label="Wycena" value={`${plnFmt(player.navPln)} zł`} />
              <Stat
                label="Trafione pozycje"
                value={closed.length ? `${wins} z ${closed.length}` : "—"}
              />
              <Stat label="Gotówka" value={`${plnFmt(player.cashPln)} zł`} />
              <Stat
                label="Obsunięcie"
                value={m ? pctFmt(m.maxDrawdownPct, 1) : "—"}
                color={m && m.maxDrawdownPct < 0 ? "var(--destructive)" : undefined}
              />
            </div>

            {detail.isLoading ? (
              <EmptyState>Wczytywanie historii…</EmptyState>
            ) : detail.isError ? (
              <EmptyState>Nie udało się wczytać historii gracza</EmptyState>
            ) : (
              <>
                <SectionTitle>Portfel teraz</SectionTitle>
                {(detail.data?.holdings.length ?? 0) === 0 ? (
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    Sama gotówka: {plnFmt(player.cashPln)} zł.
                  </p>
                ) : (
                  <ul className="mt-1">
                    {detail.data!.holdings.map((h) => (
                      <HoldingRow key={h.symbol} h={h} />
                    ))}
                  </ul>
                )}

                <SectionTitle>Historia pozycji</SectionTitle>
                {history.length === 0 ? (
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    Jeszcze żadnej transakcji.
                  </p>
                ) : (
                  <ul className="mt-1">
                    {history.map((e) => (
                      <EpisodeRow key={`${e.symbol}-${e.openedOn}-${e.side}`} e={e} />
                    ))}
                  </ul>
                )}

                {(detail.data?.trades.length ?? 0) > 0 && (
                  <Fold title="Wszystkie transakcje" hint={String(detail.data!.trades.length)}>
                    <ul>
                      {detail.data!.trades.map((t, i) => (
                        <TradeRow key={`${t.executedOn}-${t.symbol}-${i}`} t={t} />
                      ))}
                    </ul>
                  </Fold>
                )}
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
