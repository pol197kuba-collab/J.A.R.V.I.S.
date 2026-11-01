// Panel FUNDUSZ w /rynki (PLAN.md, S3.3): komu ufać, w złotówkach.
//
// Od góry: werdykt w zdaniach, karta wyników każdego gracza (co kupił, co
// sprzedał, co dało zysk, co stratę), krzywe kapitału na JEDNEJ osi w PLN
// (wszyscy startują ze 100 000 zł, więc wspólna skala jest uczciwa) i tabela
// instrument × gracz. Szczegóły — pozycje i pełna lista transakcji
// wybranego gracza z powodem każdej — są zwinięte, żeby nie zasłaniały
// podsumowania.

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import type { FundOrder, FundView } from "@/lib/fund/fund.functions";
import { DEFAULT_RULES } from "@/lib/fund/engine";
import { fundVerdict, isWaiting } from "@/lib/fund/verdict";
import { Fold } from "./Fold";
import { PlayerCards, SymbolComparison } from "./FundSummary";
import { PLAYER_COLOR, plnFmt, shortDate, signColor } from "./fundFormat";
import { Swatch } from "./Swatch";

/** Co transakcja zrobiła z pozycją — prostymi słowami. */
function orderAction(o: FundOrder): string {
  const closing = o.realizedPln !== null;
  if (o.side === "buy") return closing ? "Odkup (zamknięcie krótkiej)" : "Kupno";
  return closing ? "Sprzedaż" : "Krótka sprzedaż";
}

function NavTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="pointer-events-none rounded border border-primary/30 bg-popover px-2.5 py-1.5 shadow-lg">
      <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
        {String(label)}
      </p>
      <div className="mt-1 space-y-0.5">
        {sorted.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
              {entry.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11px] font-bold text-foreground">
              {plnFmt(Number(entry.value))}
              <span className="ml-1 text-[9px] text-muted-foreground">zł</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FundPanel({
  view,
  onRecompute,
  recomputing,
}: {
  view: FundView;
  onRecompute: () => void;
  recomputing: boolean;
}) {
  // Gracz bez prognoz nie gra — jego 0% nie może stać w rankingu nad tymi,
  // którzy grają i tracą. Idzie na koniec, bez numeru, z powodem.
  const ranked = useMemo(
    () =>
      [...view.players].sort(
        (a, b) =>
          Number(isWaiting(a)) - Number(isWaiting(b)) ||
          (b.metrics?.returnPct ?? 0) - (a.metrics?.returnPct ?? 0),
      ),
    [view.players],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected =
    view.players.find((p) => p.key === selectedKey) ??
    ranked.find((p) => p.kind === "source") ??
    ranked[0] ??
    null;

  const verdict = useMemo(
    () =>
      fundVerdict(
        view.players.map((p) => ({
          key: p.key,
          label: p.label,
          kind: p.kind,
          returnPct: p.metrics?.returnPct ?? 0,
          waiting: isWaiting(p),
        })),
        view.nav.length,
      ),
    [view.players, view.nav.length],
  );

  const chartRows = useMemo(
    () => view.nav.map((r) => ({ ...r, label: shortDate(String(r.date)) })),
    [view.nav],
  );

  const header = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 font-mono text-[10px] text-muted-foreground">
        {view.startedOn
          ? `Start ${view.startedOn} · 100 000 zł na gracza · tylko papier`
          : "Portfele na papierze: 100 000 zł na gracza"}
        {view.computedAt &&
          ` · przeliczono ${new Date(view.computedAt).toLocaleString("pl-PL", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}`}
      </p>
      <button
        type="button"
        disabled={recomputing}
        onClick={onRecompute}
        className="font-display flex h-9 items-center gap-1.5 border border-primary/50 px-3 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
      >
        <RefreshCw className={recomputing ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        Przelicz
      </button>
    </div>
  );

  if (view.players.length === 0) {
    return (
      <>
        {header}
        <EmptyState>
          Fundusz jeszcze nie przeliczony — kliknij „Przelicz” albo poczekaj na nocny przebieg
        </EmptyState>
      </>
    );
  }

  const orders = selected ? (view.orders[selected.key] ?? []) : [];
  const positions = selected ? (view.positions[selected.key] ?? []) : [];

  return (
    <>
      {header}

      {verdict.length > 0 && (
        <div className="mt-3 space-y-1 border-l-2 border-primary/40 pl-3">
          {verdict.map((line) => (
            <p
              key={line}
              className="min-w-0 break-words text-xs leading-relaxed text-foreground/85"
            >
              {line}
            </p>
          ))}
        </div>
      )}

      <PlayerCards
        view={view}
        ranked={ranked}
        selectedKey={selected?.key ?? null}
        onSelect={setSelectedKey}
      />

      {chartRows.length > 1 && (
        // Legenda w HTML, nie z recharts: zawija się na telefonie zamiast
        // nachodzić na oś i pokazuje kreskowanie odniesień (koszyk, małpa).
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda wykresu">
          {view.players
            .filter((p) => !isWaiting(p))
            .map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <Swatch
                  color={PLAYER_COLOR[p.key] ?? "var(--muted-foreground)"}
                  dashed={p.kind !== "source"}
                />
                <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">
                  {p.label}
                </span>
              </li>
            ))}
        </ul>
      )}
      {chartRows.length > 1 && (
        <div className="mt-2 h-[300px] w-full @max-[520px]:h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--primary)" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                width={52}
                domain={["auto", "auto"]}
                tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${plnFmt(v / 1000, 1)}k`}
              />
              {/* Kapitał startowy — linia odniesienia: powyżej zysk, poniżej strata. */}
              <ReferenceLine
                y={DEFAULT_RULES.startCashPln}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.4}
                strokeDasharray="2 4"
              />
              <Tooltip
                content={<NavTooltip />}
                cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
              />

              {view.players
                .filter((p) => !isWaiting(p))
                .map((p) => (
                  <Line
                    key={p.key}
                    type="monotone"
                    dataKey={p.key}
                    name={p.label}
                    stroke={PLAYER_COLOR[p.key] ?? "var(--muted-foreground)"}
                    strokeWidth={selected?.key === p.key ? 2.5 : 1.5}
                    strokeOpacity={selected && selected.key !== p.key ? 0.55 : 1}
                    strokeDasharray={p.kind === "source" ? undefined : "5 4"}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls
                    animationDuration={450}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <Fold title="Porównanie wg instrumentu" hint="zysk / strata w zł" defaultOpen>
        <SymbolComparison view={view} />
      </Fold>

      {selected && (
        <Fold
          title={`Pozycje i transakcje — ${selected.label}`}
          hint={`${orders.length} ostatnich`}
        >
          <div className="grid gap-5 @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="min-w-0">
              <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
                Pozycje
              </p>
              {positions.length === 0 ? (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  Sama gotówka: {plnFmt(selected.cashPln)} zł.
                </p>
              ) : (
                <div className="mt-1.5 space-y-1">
                  {positions.map((pos) => {
                    const pl = pos.valuePln - pos.costPln;
                    return (
                      <div key={pos.symbol} className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-foreground/90">
                          {assetBySymbol(pos.symbol)?.label ?? pos.symbol}
                          {pos.valuePln < 0 && (
                            <span className="ml-1.5 font-display text-[8px] uppercase tracking-widest text-muted-foreground">
                              krótka
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-foreground">
                          {plnFmt(Math.abs(pos.valuePln))} zł
                        </span>
                        <span
                          className="w-16 shrink-0 text-right font-mono text-[10px]"
                          style={{ color: signColor(pl) }}
                        >
                          {pl >= 0 ? "+" : "−"}
                          {plnFmt(Math.abs(pl))}
                        </span>
                      </div>
                    );
                  })}
                  <p className="pt-1 font-mono text-[10px] text-muted-foreground">
                    Gotówka: {plnFmt(selected.cashPln)} zł
                  </p>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
                Transakcje
              </p>
              {orders.length === 0 ? (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">Brak transakcji.</p>
              ) : (
                <div className="no-scrollbar mt-1.5 max-h-[360px] overflow-y-auto overflow-x-hidden">
                  {orders.map((o, i) => (
                    <div
                      key={`${o.executedOn}-${o.symbol}-${i}`}
                      className="flex min-w-0 gap-2 border-b border-primary/10 py-2"
                    >
                      {o.side === "buy" ? (
                        <ArrowUpRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                          aria-label="kupno"
                        />
                      ) : (
                        <ArrowDownRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                          aria-label="sprzedaż"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="text-foreground">
                            {orderAction(o)} {assetBySymbol(o.symbol)?.label ?? o.symbol}
                          </span>
                          <span className="font-mono text-[11px] text-foreground/80">
                            {plnFmt(o.notionalPln)} zł
                          </span>
                          {o.realizedPln !== null && (
                            <span
                              className="font-mono text-[10px]"
                              style={{ color: signColor(o.realizedPln) }}
                            >
                              wynik {o.realizedPln >= 0 ? "+" : "−"}
                              {plnFmt(Math.abs(o.realizedPln))} zł
                            </span>
                          )}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {o.executedOn} · prognoza z {o.signalOn} ({o.confidence}%) · prowizja{" "}
                          {plnFmt(o.feePln, 2)} zł
                        </p>
                        {o.reason && (
                          <p className="mt-0.5 min-w-0 break-words text-[11px] leading-snug text-foreground/70">
                            {o.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Fold>
      )}

      <Fold title="Zasady gry">
        <PanelHint>
          Realizacja po kolejnym notowaniu (nigdy po cenie, którą prognoza już znała), prowizja 0,1%
          + spread. „Wzrost” = kupno, „spadek” = krótka sprzedaż (na papierze), „bez zmian” = nic
          nowego. Pozycja = 20% × pewność × dźwignia; dźwignia rośnie z pewnością od 1× (do 60%) do
          2× (100%), łączna ekspozycja najwyżej 2× kapitału. Pożyczona gotówka kosztuje 7% rocznie,
          pożyczone papiery 1–10% rocznie (krypto najdrożej). Margin call: gdy kapitał spadnie
          poniżej połowy wymaganego depozytu, wszystko jest zamykane. Stop-loss 1σ i take-profit
          1,5σ zmienności w horyzoncie, przesuwane przy każdym potwierdzeniu prognozy. Pozycja żyje
          tyle, ile horyzont prognozy (2 dni; gracz kontrolny — 7 dni). Koszyk kupuje wszystko po
          równo w dniu startu i trzyma bez dźwigni; małpa rzuca losowo na tych samych zasadach co
          gracze.
        </PanelHint>
      </Fold>
    </>
  );
}
