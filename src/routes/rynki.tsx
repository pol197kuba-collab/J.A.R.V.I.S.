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
import { RefreshCw, TriangleAlert } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Chips, EmptyState, LiveDot, PanelHint, StatTile } from "@/components/jarvis/fuel/chrome";
import { MarketChart, type ChartMode } from "@/components/jarvis/markets/MarketChart";
import { MarketWatchRail } from "@/components/jarvis/markets/MarketWatchRail";
import { MarketNewsPanel } from "@/components/jarvis/markets/MarketNewsPanel";
import { SentimentPanel } from "@/components/jarvis/markets/SentimentPanel";
import { OutlookPanel } from "@/components/jarvis/markets/OutlookPanel";
import { AccuracyPanel } from "@/components/jarvis/markets/AccuracyPanel";
import { AssetPicker } from "@/components/jarvis/markets/AssetPicker";
import { StandingOrdersPanel } from "@/components/jarvis/orders/StandingOrdersPanel";
import { listStandingOrders } from "@/lib/orders/orders.functions";
import { formatPercent, formatPrice } from "@/lib/markets/series";
import { projectForecast, type ForecastPoint } from "@/lib/markets/projection";
import {
  addToWatchlist,
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

  const fetchOrders = useServerFn(listStandingOrders);
  const orders = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchOrders({ data: { subjectKind: "market" } }),
    refetchInterval: 5 * 60_000,
  });

  const grid = useQuery({
    queryKey: ["market-grid", range],
    queryFn: () => fetchGrid({ data: { days: range } }),
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
    mutationFn: () => fetchGrid({ data: { days: range, force: true } }),
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

  const watched = series.map((s) => s.symbol);
  const primary = series.find((s) => s.symbol === visibleSymbols[0]) ?? null;
  const missing = grid.data?.missing ?? [];

  return (
    <div className="space-y-6">
      <HudPanel index={0} title="MARKET GRID // OVERVIEW" tone="elevated" className="p-5">
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <LiveDot active={grid.isFetching} label={grid.isFetching ? "SYNC" : "LIVE"} />
          <button
            type="button"
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
            className="font-display flex items-center gap-1.5 border border-primary/50 px-3 py-1 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
          >
            <RefreshCw className={refreshMutation.isPending ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            ODŚWIEŻ
          </button>
        </div>

        <div className="mt-4 grid gap-4 @[560px]:grid-cols-2 @[900px]:grid-cols-4">
          <StatTile
            label="Obserwowane"
            value={String(series.length)}
            hint={missing.length > 0 ? `${missing.length} bez danych` : "wszystkie z danymi"}
          />
          <StatTile
            label="Największy wzrost"
            value={movers.top ? formatPercent(movers.top.stats.change1d) : "—"}
            color={changeColor(movers.top?.stats.change1d)}
            hint={movers.top?.label}
          />
          <StatTile
            label="Największy spadek"
            value={movers.bottom ? formatPercent(movers.bottom.stats.change1d) : "—"}
            color={changeColor(movers.bottom?.stats.change1d)}
            hint={movers.bottom?.label}
          />
          <StatTile
            label={primary ? primary.label : "Wybrany"}
            value={primary ? formatPrice(primary.stats.last, primary.currency) : "—"}
            hint={primary?.stats.lastDate ?? undefined}
          />
        </div>

        <PanelHint>
          Zmiany liczone w sesjach, nie w dniach kalendarzowych: dla akcji tydzień to 5 sesji, dla
          krypto 7. Dane pochodzą z publicznych, darmowych źródeł (CoinGecko, Stooq, Yahoo Finance,
          Frankfurter) i są orientacyjne — nie nadają się do rozliczeń.
        </PanelHint>
      </HudPanel>

      <HudPanel index={1} title="MARKET GRID // CHART" className="p-5">
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chips options={RANGES} value={range} onChange={setRange} ariaLabel="Zakres czasu" />
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

        {grid.isLoading ? (
          <EmptyState>Ładowanie notowań…</EmptyState>
        ) : (
          <>
            <MarketChart
              series={series}
              visibleSymbols={visibleSymbols}
              mode={mode}
              forecasts={forecasts}
            />
            {/* Kreskowanie i pasmo trzeba nazwać. Przy jednym instrumencie nie
                ma legendy, a nawet przy kilku legenda mówi, CZYJA to linia,
                nie co znaczy jej przerywanie. */}
            {Object.keys(forecasts).some((sym) => visibleSymbols.includes(sym)) && (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Linia przerywana — prognoza na {outlook.data?.horizonDays ?? 7} dni. Pasmo — zakres
                niepewności; im szersze, tym mniejsza pewność typera.
              </p>
            )}
          </>
        )}

        <PanelHint>
          {mode === "price"
            ? "Tryb cenowy rysuje jeden instrument w jego walucie. Aby porównać kilka naraz, przełącz na „Indeks 100”."
            : "Każda seria przeskalowana do 100 w pierwszym dniu zakresu — porównanie kierunku i siły ruchu niezależnie od ceny i waluty."}
        </PanelHint>
      </HudPanel>

      <HudPanel index={2} title="MARKET GRID // WATCHLIST" className="p-5">
        {series.length === 0 && !grid.isLoading ? (
          <EmptyState>Brak danych — dodaj instrument poniżej</EmptyState>
        ) : (
          <MarketWatchRail
            series={series}
            visibleSymbols={visibleSymbols}
            onToggle={toggleVisible}
            onRemove={(symbol) => removeMutation.mutate(symbol)}
            removingSymbol={removeMutation.isPending ? (removeMutation.variables ?? null) : null}
          />
        )}
      </HudPanel>

      {missing.length > 0 && (
        <HudPanel index={3} title="MARKET GRID // DIAGNOSTYKA" tone="quiet" className="p-5">
          <div className="mt-3 space-y-1.5">
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
            Darmowe źródła notowań bywają zawodne: Stooq potrafi odpowiedzieć stroną anty-bot, a
            Yahoo limitować ruch po adresie IP serwera. Moduł próbuje kolejnych dostawców i pokazuje
            tu ten, na którym się zatrzymał — pełne komunikaty trafiają też do System Logs.
          </PanelHint>
        </HudPanel>
      )}

      <div className="grid gap-6 @[900px]:grid-cols-[1fr_360px]">
        <HudPanel index={3} title="MARKET GRID // TYPER" tone="elevated" className="min-w-0 p-5">
          {outlook.isLoading ? (
            <EmptyState>Liczenie sygnałów…</EmptyState>
          ) : (
            <OutlookPanel
              rows={outlook.data?.rows ?? []}
              horizonDays={outlook.data?.horizonDays ?? 7}
              model={outlook.data?.model ?? null}
            />
          )}
        </HudPanel>

        <HudPanel index={3} title="MARKET GRID // SKUTECZNOŚĆ" tone="quiet" className="min-w-0 p-5">
          {scoreboard.isLoading ? (
            <EmptyState>Rozliczanie prognoz…</EmptyState>
          ) : scoreboard.data ? (
            <AccuracyPanel board={scoreboard.data} />
          ) : (
            <EmptyState>Brak danych o skuteczności</EmptyState>
          )}
        </HudPanel>
      </div>

      <div className="grid gap-6 @[900px]:grid-cols-[1fr_360px]">
        <HudPanel index={3} title="MARKET GRID // NEWSY" className="min-w-0 p-5">
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
        </HudPanel>

        <HudPanel index={3} title="MARKET GRID // WYDŹWIĘK" tone="quiet" className="min-w-0 p-5">
          {news.isLoading ? (
            <EmptyState>Liczenie…</EmptyState>
          ) : (
            <SentimentPanel
              rows={news.data?.sentiment ?? []}
              onSelect={(symbol) => setNewsSymbol((prev) => (prev === symbol ? null : symbol))}
            />
          )}
        </HudPanel>
      </div>

      <HudPanel index={4} title="MARKET GRID // ROZKAZY" tone="quiet">
        <StandingOrdersPanel
          subjectKind="market"
          orders={orders.data ?? []}
          seriesBySubject={orderSeries}
          defaultSubject={visibleSymbols[0]}
          queryKey={ORDERS_QUERY_KEY}
        />
      </HudPanel>

      <HudPanel index={5} title="MARKET GRID // DODAJ INSTRUMENT" tone="quiet" className="p-5">
        <AssetPicker
          watched={watched}
          onAdd={(symbol) => addMutation.mutate(symbol)}
          addingSymbol={addMutation.isPending ? (addMutation.variables ?? null) : null}
        />
      </HudPanel>
    </div>
  );
}
