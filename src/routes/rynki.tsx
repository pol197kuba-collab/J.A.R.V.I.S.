// MARKET GRID — monitoring cen akcji, krypto, surowców, indeksów i walut.
//
// Etap 1: dane, cache, wykresy i watchlista. Etap 2: newsy z oceną wpływu.
// Etap 3: sygnały techniczne, ranking „co może rosnąć / spadać" i pomiar
// własnej trafności.
//
// Typer ma własne zapytanie i własny, rzadki interwał: przeliczenie kosztuje
// wywołanie modelu, a horyzont prognozy to tydzień — odświeżanie go co
// minutę nic nie wnosi poza rachunkiem.
//
// Strona odpytuje jedną server function z interwałem 5 minut. Serwer i tak
// nie wypuści żądania do zewnętrznych API częściej niż pozwala próg
// świeżości (30 min, 10 min dla krypto), więc ten interwał jest tani —
// prawie zawsze trafia w cache.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, RefreshCw, TriangleAlert } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Chips, EmptyState, LiveDot, PanelHint, StatTile } from "@/components/jarvis/fuel/chrome";
import { MarketChart, type ChartMode } from "@/components/jarvis/markets/MarketChart";
import { MarketNewsPanel } from "@/components/jarvis/markets/MarketNewsPanel";
import { OutlookPanel } from "@/components/jarvis/markets/OutlookPanel";
import { AccuracyPanel } from "@/components/jarvis/markets/AccuracyPanel";
import { AccuracySummary } from "@/components/jarvis/markets/AccuracySummary";
import { FundPanel } from "@/components/jarvis/markets/FundPanel";
import { Fold } from "@/components/jarvis/markets/Fold";
import { InstrumentList } from "@/components/jarvis/markets/InstrumentList";
import {
  accuracyHeadline,
  breadth,
  fundHeadline,
  instrumentGroups,
  newsMood,
} from "@/components/jarvis/markets/marketsDigest";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StandingOrdersPanel } from "@/components/jarvis/orders/StandingOrdersPanel";
import { listStandingOrders } from "@/lib/orders/orders.functions";
import { getFund, recomputeFundNow } from "@/lib/fund/fund.functions";
import { formatPercent, formatPrice } from "@/lib/markets/series";
import { projectForecast, type ForecastPoint } from "@/lib/markets/projection";
import {
  addToWatchlist,
  getAssetCatalog,
  getMarketGrid,
  getMarketNews,
  getMarketOutlook,
  getPredictionScoreboard,
  removeFromWatchlist,
  type MarketSeries,
} from "@/lib/markets/markets.functions";

export const Route = createFileRoute("/rynki")({
  head: () => ({
    meta: [
      { title: "JARVIS // Rynki" },
      {
        name: "description",
        content:
          "Monitoring cen akcji, kryptowalut, surowców, indeksów i walut: wykresy, watchlista i statystyki zmian.",
      },
    ],
  }),
  component: MarketsPage,
});

const RANGES = [
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 180, label: "6M" },
  { value: 365, label: "1R" },
] as const;

const MODES: ReadonlyArray<{ value: ChartMode; label: string }> = [
  { value: "price", label: "Cena" },
  { value: "index", label: "Indeks 100" },
];

const changeColor = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "var(--muted-foreground)";
  }
  return value > 0 ? "var(--success)" : value < 0 ? "var(--destructive)" : "var(--foreground)";
};

/** Wspólny klucz: panel rozkazów unieważnia dokładnie to zapytanie. */
const ORDERS_QUERY_KEY = ["orders", "market"] as const;

function MarketsPage() {
  const fetchGrid = useServerFn(getMarketGrid);
  const addSymbol = useServerFn(addToWatchlist);
  const removeSymbol = useServerFn(removeFromWatchlist);
  const qc = useQueryClient();

  const [range, setRange] = useState<number>(90);
  const [mode, setMode] = useState<ChartMode>("price");
  const [visibleSymbols, setVisibleSymbols] = useState<string[]>([]);
  const [newsSymbol, setNewsSymbol] = useState<string | null>(null);
  // Instruments put on the chart from the list without being watched: their
  // quotes come with the grid (at most 3, the most recent).
  const [previews, setPreviews] = useState<string[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);

  const fetchCatalog = useServerFn(getAssetCatalog);
  const catalog = useQuery({
    queryKey: ["market-catalog"],
    queryFn: () => fetchCatalog(),
    staleTime: Infinity,
  });

  const fetchOrders = useServerFn(listStandingOrders);
  const orders = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchOrders({ data: { subjectKind: "market" } }),
    refetchInterval: 5 * 60_000,
  });

  const grid = useQuery({
    queryKey: ["market-grid", range, previews],
    queryFn: () => fetchGrid({ data: { days: range, extra: previews } }),
    placeholderData: (prev) => prev,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  // Newsy mają własne zapytanie i własny interwał: kanały RSS żyją szybciej
  // niż notowania dzienne, a filtr po instrumencie nie może przeładowywać
  // całej siatki cen.
  const fetchNews = useServerFn(getMarketNews);
  const news = useQuery({
    queryKey: ["market-news", newsSymbol],
    queryFn: () => fetchNews({ data: newsSymbol ? { symbol: newsSymbol } : {} }),
    refetchInterval: 10 * 60_000,
    staleTime: 2 * 60_000,
  });

  const fetchOutlook = useServerFn(getMarketOutlook);
  const outlook = useQuery({
    queryKey: ["market-outlook"],
    queryFn: () => fetchOutlook({ data: {} }),
    refetchInterval: 60 * 60_000,
    staleTime: 30 * 60_000,
  });

  // Rozliczanie prognoz dzieje się przy okazji odczytu tablicy wyników —
  // nie ma tu nocnego joba, a prognoza sprzed tygodnia ma się rozliczyć
  // sama, gdy ktokolwiek wejdzie na stronę.
  const fetchScoreboard = useServerFn(getPredictionScoreboard);
  const scoreboard = useQuery({
    queryKey: ["market-scoreboard"],
    queryFn: () => fetchScoreboard(),
    refetchInterval: 30 * 60_000,
    staleTime: 10 * 60_000,
  });

  const series = useMemo<MarketSeries[]>(() => grid.data?.series ?? [], [grid.data]);

  // Notowania w kształcie ewaluatora rozkazów — ten sam kod, którym ocenia
  // je nocny job, zaznacza tutaj rozkazy spełnione w tej chwili.
  const orderSeries = useMemo(
    () =>
      Object.fromEntries(
        series.map((s) => [s.symbol, s.points.map((p) => ({ date: p.date, value: p.close }))]),
      ),
    [series],
  );

  // Pierwszy instrument z watchlisty wchodzi na wykres sam, żeby strona nie
  // otwierała się pustym panelem. Kolejne odświeżenia nie ruszają wyboru
  // użytkownika — pilnuje tego warunek na pustej tablicy.
  useEffect(() => {
    if (visibleSymbols.length === 0 && series.length > 0) {
      setVisibleSymbols([series[0].symbol]);
    }
  }, [series, visibleSymbols.length]);

  const toggleVisible = (symbol: string) => {
    // not watched and not loaded yet: fetch it with the grid as a preview
    if (!series.some((s) => s.symbol === symbol)) {
      setPreviews((prev) => [...prev.filter((p) => p !== symbol), symbol].slice(-3));
    }
    setVisibleSymbols((prev) => {
      if (prev.includes(symbol)) {
        // Ostatniej widocznej serii nie da się zgasić — pusty wykres nie jest
        // stanem, do którego ktokolwiek celuje jednym kliknięciem.
        return prev.length === 1 ? prev : prev.filter((s) => s !== symbol);
      }
      // Tryb cenowy rysuje dokładnie jeden instrument (jedna oś, jedna
      // waluta), więc kliknięcie tam podmienia wybór zamiast dokładać serię.
      return mode === "price" ? [symbol] : [...prev, symbol];
    });
  };

  const addMutation = useMutation({
    mutationFn: (symbol: string) => addSymbol({ data: { symbol } }),
    onSuccess: async (result) => {
      toast.success(`Dodano ${result.symbol} do obserwowanych`);
      setPreviews((prev) => prev.filter((p) => p !== result.symbol));
      await qc.invalidateQueries({ queryKey: ["market-grid"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Nie udało się dodać instrumentu"),
  });

  const removeMutation = useMutation({
    mutationFn: (symbol: string) => removeSymbol({ data: { symbol } }),
    onSuccess: async (_result, symbol) => {
      setVisibleSymbols((prev) => prev.filter((s) => s !== symbol));
      await qc.invalidateQueries({ queryKey: ["market-grid"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Nie udało się usunąć instrumentu"),
  });

  const refreshMutation = useMutation({
    mutationFn: () => fetchGrid({ data: { days: range, force: true, extra: previews } }),
    onSuccess: async () => {
      toast.success("Notowania odświeżone");
      await qc.invalidateQueries({ queryKey: ["market-grid"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Odświeżenie nie powiodło się"),
  });

  // Nagłówek: największy wzrost i największy spadek dnia na watchliście.
  const movers = useMemo(() => {
    const ranked = series
      .filter((s) => s.stats.change1d !== null)
      .sort((a, b) => (b.stats.change1d ?? 0) - (a.stats.change1d ?? 0));
    return { top: ranked[0] ?? null, bottom: ranked[ranked.length - 1] ?? null };
  }, [series]);

  // Prognozy dorysowywane na wykresie: bierzemy werdykt typera dla każdego
  // instrumentu i przedłużamy jego notowania o horyzont prognozy. Liczone tu,
  // a nie na serwerze, bo obie składowe — notowania i werdykty — i tak są już
  // w pamięci przeglądarki, a rachunek jest trywialny.
  const forecasts = useMemo<Record<string, ForecastPoint[]>>(() => {
    const rows = outlook.data?.rows ?? [];
    const horizon = outlook.data?.horizonDays ?? 7;
    const out: Record<string, ForecastPoint[]> = {};
    for (const s of series) {
      const row = rows.find((r) => r.symbol === s.symbol);
      if (!row) continue;
      // Werdykt modelu ma pierwszeństwo przed samą techniką, dokładnie tak
      // jak w panelu typera — na wykresie ma się pojawić TA SAMA prognoza,
      // którą użytkownik czyta obok, a nie jej druga wersja.
      const direction = row.ai?.direction ?? row.direction;
      const confidence = row.ai?.confidence ?? row.confidence;
      const path = projectForecast(s.points, { score: row.score, direction, confidence }, horizon);
      if (path.length > 0) out[s.symbol] = path;
    }
    return out;
  }, [series, outlook.data]);

  // Fundusz: przeliczany nocą (krok w market-grid) albo przyciskiem —
  // samo wejście na stronę tylko czyta, bo przeliczenie to cała historia.
  const fetchFund = useServerFn(getFund);
  const recomputeFund = useServerFn(recomputeFundNow);
  const fund = useQuery({
    queryKey: ["fund"],
    queryFn: () => fetchFund(),
    staleTime: 5 * 60_000,
  });
  const fundMutation = useMutation({
    mutationFn: () => recomputeFund(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fund"] }),
    onError: (err) =>
      toast.error(`Nie udało się przeliczyć funduszu: ${err instanceof Error ? err.message : err}`),
  });

  const primary = series.find((s) => s.symbol === visibleSymbols[0]) ?? null;
  const missing = grid.data?.missing ?? [];

  // ---- the CEO view: plain facts first, details folded below ----
  const watchedSeries = useMemo(() => series.filter((s) => s.watched !== false), [series]);
  const market = useMemo(() => breadth(watchedSeries), [watchedSeries]);
  const fundTop = useMemo(() => fundHeadline(fund.data?.players), [fund.data]);
  const hits = useMemo(() => accuracyHeadline(scoreboard.data), [scoreboard.data]);
  const mood = useMemo(() => newsMood(news.data?.items), [news.data]);
  const groups = useMemo(() => {
    const quotes = new Map(
      series.map((s) => [
        s.symbol,
        { last: s.stats.last, change1d: s.stats.change1d, currency: s.currency },
      ]),
    );
    return instrumentGroups(
      catalog.data?.assets ?? [],
      new Set(watchedSeries.map((s) => s.symbol)),
      quotes,
    );
  }, [catalog.data, series, watchedSeries]);
  const watchBusy = addMutation.isPending
    ? (addMutation.variables ?? null)
    : removeMutation.isPending
      ? (removeMutation.variables ?? null)
      : null;
  const activeOrders = (orders.data ?? []).filter((o) => o.isEnabled).length;

  return (
    <div className="space-y-8">
      <HudPanel index={0} title="MARKET GRID // PULS" tone="elevated" className="p-5">
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <LiveDot active={grid.isFetching} label={grid.isFetching ? "SYNC" : "LIVE"} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOrdersOpen(true)}
              className="font-display flex items-center gap-1.5 border border-primary/50 px-3 py-1 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20"
            >
              <Bell className="h-3 w-3" />
              Powiadomienia
              {activeOrders > 0 && <span className="text-muted-foreground">{activeOrders}</span>}
            </button>
            <button
              type="button"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
              className="font-display flex items-center gap-1.5 border border-primary/50 px-3 py-1 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
            >
              <RefreshCw
                className={refreshMutation.isPending ? "h-3 w-3 animate-spin" : "h-3 w-3"}
              />
              Odśwież
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 @[900px]:grid-cols-4">
          <StatTile
            label="Fundusz · lider"
            value={fundTop ? formatPercent(fundTop.returnPct) : "—"}
            color={changeColor(fundTop?.returnPct)}
            hint={
              fundTop
                ? `${fundTop.label}${fundTop.basketPct !== null ? ` · koszyk ${formatPercent(fundTop.basketPct)}` : ""}`
                : "gracze jeszcze nie grają"
            }
          />
          <StatTile
            label="Skuteczność prognoz"
            value={hits?.meaningful ? `${hits.outOfTen} / 10` : "—"}
            hint={
              hits
                ? hits.meaningful
                  ? `${hits.name} trafia ${hits.outOfTen} na 10`
                  : `zbiera dane: ${hits.settled} z ${hits.needed} rozliczonych`
                : undefined
            }
          />
          <StatTile
            label="Rynek dziś"
            value={market.known ? `${market.up}↑ ${market.down}↓` : "—"}
            color={
              market.up > market.down
                ? "var(--success)"
                : market.down > market.up
                  ? "var(--destructive)"
                  : undefined
            }
            hint={
              market.top && market.bottom
                ? `${market.top.label} ${formatPercent(market.top.stats.change1d)} · ${market.bottom.label} ${formatPercent(market.bottom.stats.change1d)}`
                : undefined
            }
          />
          <StatTile
            label="Newsy"
            value={mood ? `${mood.up}↑ ${mood.down}↓` : "—"}
            color={
              mood?.lean === "up"
                ? "var(--success)"
                : mood?.lean === "down"
                  ? "var(--destructive)"
                  : undefined
            }
            hint={
              mood
                ? mood.lean === "up"
                  ? "przewaga wzrostowych"
                  : mood.lean === "down"
                    ? "przewaga spadkowych"
                    : `mieszane · ${mood.neutral} neutralnych`
                : undefined
            }
          />
        </div>
      </HudPanel>

      <HudPanel index={1} title="MARKET GRID // WYKRES" className="p-5">
        <div className="mt-3 grid gap-5 @[900px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display truncate text-[18px] uppercase tracking-[0.14em]">
                  {primary?.label ?? "Wybierz instrument"}
                </p>
                {primary && (
                  <p className="mt-1 font-mono text-[13px] tabular-nums">
                    {formatPrice(primary.stats.last, primary.currency)}
                    <span className="ml-2" style={{ color: changeColor(primary.stats.change1d) }}>
                      {formatPercent(primary.stats.change1d)}
                    </span>
                    {primary.watched === false && (
                      <span className="ml-2 text-[10px] text-muted-foreground">podgląd</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chips
                  options={RANGES}
                  value={range}
                  onChange={setRange}
                  ariaLabel="Zakres czasu"
                />
                <Chips
                  options={MODES}
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    // Powrót do trybu cenowego zostawia jedną serię — wspólna oś
                    // cenowa dla dwóch walut nie miałaby sensu.
                    if (next === "price") setVisibleSymbols((prev) => prev.slice(0, 1));
                  }}
                  ariaLabel="Tryb wykresu"
                />
              </div>
            </div>

            {grid.isLoading ? (
              <EmptyState>Ładowanie notowań…</EmptyState>
            ) : (
              <MarketChart
                series={series}
                visibleSymbols={visibleSymbols}
                mode={mode}
                forecasts={forecasts}
              />
            )}
            <PanelHint>
              {Object.keys(forecasts).some((sym) => visibleSymbols.includes(sym))
                ? `Linia przerywana — prognoza na ${outlook.data?.horizonDays ?? 7} dni; pasmo — niepewność. `
                : ""}
              {mode === "price"
                ? "Cena jednego instrumentu w jego walucie. Kilka naraz: „Indeks 100”."
                : "Każda seria = 100 w pierwszym dniu zakresu: porównanie kierunku i siły ruchu."}
            </PanelHint>
          </div>

          <div className="flex min-w-0 flex-col @[900px]:h-[520px] @max-[899px]:order-first">
            <InstrumentList
              groups={groups}
              selected={visibleSymbols}
              onSelect={toggleVisible}
              onToggleWatch={(symbol, isWatched) =>
                isWatched ? removeMutation.mutate(symbol) : addMutation.mutate(symbol)
              }
              busySymbol={watchBusy}
            />
            <p className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
              Zmiany w sesjach (tydzień akcji = 5, krypto = 7). Dane z darmowych źródeł —
              orientacyjne.
            </p>
          </div>
        </div>
      </HudPanel>

      {/* Fundusz: wyniki agentów w złotówkach to pierwsze, co sprawdzamy. */}
      <HudPanel index={2} title="MARKET GRID // FUNDUSZ" tone="elevated" className="min-w-0 p-5">
        {fund.isLoading ? (
          <EmptyState>Ładowanie funduszu…</EmptyState>
        ) : fund.data ? (
          <FundPanel
            view={fund.data}
            onRecompute={() => fundMutation.mutate()}
            recomputing={fundMutation.isPending}
          />
        ) : (
          <EmptyState>Nie udało się wczytać funduszu</EmptyState>
        )}
      </HudPanel>

      <HudPanel index={3} title="MARKET GRID // SKUTECZNOŚĆ" tone="quiet" className="min-w-0 p-5">
        {scoreboard.isLoading ? (
          <EmptyState>Rozliczanie prognoz…</EmptyState>
        ) : scoreboard.data ? (
          <>
            <AccuracySummary board={scoreboard.data} />
            <Fold title="Wszystkie szczegóły i wnioski">
              <AccuracyPanel board={scoreboard.data} />
            </Fold>
          </>
        ) : (
          <EmptyState>Brak danych o skuteczności</EmptyState>
        )}
      </HudPanel>

      <HudPanel index={4} title="MARKET GRID // SZCZEGÓŁY" tone="quiet" className="min-w-0 p-5">
        <Fold
          title={`Typer — prognozy na ${outlook.data?.horizonDays ?? 7} dni`}
          hint={outlook.data ? `${outlook.data.rows.length} instrumentów` : undefined}
        >
          {outlook.isLoading ? (
            <EmptyState>Liczenie sygnałów…</EmptyState>
          ) : (
            <OutlookPanel
              rows={outlook.data?.rows ?? []}
              horizonDays={outlook.data?.horizonDays ?? 7}
              model={outlook.data?.model ?? null}
            />
          )}
        </Fold>
        <Fold title="Newsy" hint={news.data ? `${news.data.items.length} pozycji` : undefined}>
          {news.isLoading ? (
            <EmptyState>Ładowanie newsów…</EmptyState>
          ) : (
            <MarketNewsPanel
              items={news.data?.items ?? []}
              aiCount={news.data?.aiCount ?? 0}
              errors={news.data?.errors ?? []}
              filterSymbol={newsSymbol}
              onClearFilter={() => setNewsSymbol(null)}
            />
          )}
        </Fold>
        {missing.length > 0 && (
          <Fold title="Diagnostyka źródeł notowań" hint={`${missing.length} bez danych`}>
            <div className="space-y-1.5">
              {missing.map((m) => (
                <div key={m.symbol} className="flex min-w-0 items-start gap-2">
                  <TriangleAlert
                    className="mt-0.5 h-3 w-3 shrink-0"
                    style={{ color: "var(--warning)" }}
                  />
                  <p className="min-w-0 break-words font-mono text-[10px] text-muted-foreground">
                    <span className="text-foreground">{m.label}</span> ({m.symbol}): {m.reason}
                  </p>
                </div>
              ))}
            </div>
            <PanelHint>
              Darmowe źródła notowań bywają zawodne (Stooq, Yahoo). Moduł próbuje kolejnych
              dostawców; pełne komunikaty trafiają też do System Logs.
            </PanelHint>
          </Fold>
        )}
      </HudPanel>

      {/* Rozkazy (powiadomienia o progach cen) — w wysuwanym panelu, nie na stronie. */}
      <Sheet open={ordersOpen} onOpenChange={setOrdersOpen}>
        <SheetContent
          side="right"
          className="no-scrollbar w-full overflow-y-auto overflow-x-hidden sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle className="font-display text-[12px] uppercase tracking-[0.3em] text-primary">
              Powiadomienia rynkowe
            </SheetTitle>
            <SheetDescription className="text-[11px]">
              Rozkazy stałe: J.A.R.V.I.S. powiadomi Cię, gdy cena przekroczy ustawiony próg.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 min-w-0">
            <StandingOrdersPanel
              subjectKind="market"
              orders={orders.data ?? []}
              seriesBySubject={orderSeries}
              defaultSubject={visibleSymbols[0]}
              queryKey={ORDERS_QUERY_KEY}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
