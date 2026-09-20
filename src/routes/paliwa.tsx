// ORLEN FUEL GRID — monitoring hurtowych cen paliw.
//
// Strona odpytuje cztery server functions niezależnie, każdą z własnym
// interwałem: ceny i rynek co 5 minut (Orlen publikuje raz dziennie, ale
// odświeżenie ma złapać publikację bez przeładowania karty), newsy co 10.
// Serwer i tak nie wypuści żądania do źródła częściej niż pozwala strażnik
// świeżości, więc te interwały są tanie — trafiają w cache.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { DatabaseBackup } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Chips, LiveDot } from "@/components/jarvis/fuel/chrome";
import { FuelHeroPanel } from "@/components/jarvis/fuel/FuelHeroPanel";
import { FuelProductRail } from "@/components/jarvis/fuel/FuelProductRail";
import {
  FuelChartLegend,
  FuelPriceChart,
  type ChartMode,
} from "@/components/jarvis/fuel/FuelPriceChart";
import { MarketOverlayPanel } from "@/components/jarvis/fuel/MarketOverlayPanel";
import { ForecastPanel } from "@/components/jarvis/fuel/ForecastPanel";
import { ChangeHeatmap } from "@/components/jarvis/fuel/ChangeHeatmap";
import { FuelNewsPanel } from "@/components/jarvis/fuel/FuelNewsPanel";
import { FuelAlertsPanel } from "@/components/jarvis/fuel/FuelAlertsPanel";
import { DEFAULT_PRODUCT_ID } from "@/lib/fuel/orlen";
import {
  backfillFuelHistory,
  getFuelAlerts,
  getFuelForecast,
  getFuelGrid,
  getFuelNews,
  getMarketOverlay,
} from "@/lib/fuel/fuel.functions";

export const Route = createFileRoute("/paliwa")({
  head: () => ({
    meta: [
      { title: "JARVIS // Paliwa" },
      {
        name: "description",
        content:
          "Monitoring hurtowych cen paliw Orlenu: wykresy, kontekst ropy Brent i USD/PLN, prognoza i newsy wpływające na cenę.",
      },
    ],
  }),
  component: FuelPage,
});

const RANGES = [
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 365, label: "1R" },
  { value: 1825, label: "5L" },
  { value: 8000, label: "MAX" },
] as const;

const MODES: ReadonlyArray<{ value: ChartMode; label: string }> = [
  { value: "pln", label: "PLN/m³" },
  { value: "index", label: "Indeks 100" },
  { value: "spread", label: "Spread do ropy" },
];

function FuelPage() {
  const fetchGrid = useServerFn(getFuelGrid);
  const fetchOverlay = useServerFn(getMarketOverlay);
  const fetchForecast = useServerFn(getFuelForecast);
  const fetchNews = useServerFn(getFuelNews);
  const fetchAlerts = useServerFn(getFuelAlerts);
  const runBackfill = useServerFn(backfillFuelHistory);
  const qc = useQueryClient();

  const [range, setRange] = useState<number>(365);
  const [mode, setMode] = useState<ChartMode>("pln");
  const [selectedId, setSelectedId] = useState<number>(DEFAULT_PRODUCT_ID);
  const [visibleIds, setVisibleIds] = useState<number[]>([DEFAULT_PRODUCT_ID]);
  const [showBrent, setShowBrent] = useState(false);

  const gridQuery = useQuery({
    queryKey: ["fuel", "grid", range],
    queryFn: () => fetchGrid({ data: { days: range } }),
    refetchInterval: 5 * 60_000,
  });

  // Nakładka rynkowa ma własny, krótszy zakres niż wykres główny: Yahoo
  // i NBP i tak nie sięgają 2004 roku, a korelacja liczona na 20 latach
  // mówiłaby o epoce, nie o dzisiejszym rynku.
  const overlayDays = Math.min(range, 730);
  const overlayQuery = useQuery({
    queryKey: ["fuel", "overlay", overlayDays, selectedId],
    queryFn: () => fetchOverlay({ data: { days: overlayDays, productId: selectedId } }),
    refetchInterval: 5 * 60_000,
  });

  const forecastQuery = useQuery({
    queryKey: ["fuel", "forecast", selectedId],
    queryFn: () => fetchForecast({ data: { productId: selectedId, horizonDays: 5 } }),
    refetchInterval: 5 * 60_000,
  });

  const newsQuery = useQuery({
    queryKey: ["fuel", "news"],
    queryFn: () => fetchNews({ data: { limit: 40 } }),
    refetchInterval: 10 * 60_000,
  });

  const alertsQuery = useQuery({
    queryKey: ["fuel", "alerts"],
    queryFn: () => fetchAlerts({}),
    refetchInterval: 5 * 60_000,
  });

  const backfillMutation = useMutation({
    mutationFn: () => runBackfill({}),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["fuel"] });
      toast("Archiwizacja zakończona", {
        description:
          result.errors.length > 0
            ? `Zapisano ${result.written} wierszy, błędy: ${result.errors.join("; ")}`
            : `Zapisano ${result.written} wierszy historii od 2004 roku.`,
      });
    },
    onError: (err: unknown) =>
      toast("Archiwizacja nie powiodła się", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  // `?? []` tworzyłoby nową tablicę przy każdym renderze, więc pochodne
  // useMemo przeliczałyby się bez powodu — stąd własne memo na samą serię.
  const series = useMemo(() => gridQuery.data?.series ?? [], [gridQuery.data]);
  const selected = useMemo(
    () => series.find((s) => s.productId === selectedId),
    [series, selectedId],
  );

  const busy =
    gridQuery.isFetching ||
    overlayQuery.isFetching ||
    newsQuery.isFetching ||
    forecastQuery.isFetching;

  const toggleVisible = (productId: number) =>
    setVisibleIds((current) =>
      current.includes(productId)
        ? // Ostatniej widocznej serii nie da się zgasić — pusty wykres nie
          // jest stanem, do którego użytkownik chciałby trafić przypadkiem.
          current.length === 1
          ? current
          : current.filter((id) => id !== productId)
        : [...current, productId],
    );

  const handleSelect = (productId: number) => {
    setSelectedId(productId);
    setVisibleIds((current) => (current.includes(productId) ? current : [...current, productId]));
  };

  return (
    <div className="space-y-6 p-6 @max-[420px]:space-y-4 @max-[420px]:p-4">
      <HudPanel
        index={0}
        title="ORLEN // CENNIK HURTOWY"
        rightSlot={<LiveDot active={busy} />}
        tone="elevated"
      >
        <FuelHeroPanel fuel={selected} lastPublished={gridQuery.data?.lastPublished ?? null} />
      </HudPanel>

      <HudPanel index={1} title="PALIWA // PRZEGLĄD" tone="quiet" className="p-5 @max-[420px]:p-4">
        {gridQuery.isLoading ? (
          <p className="font-display py-6 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Ładowanie cennika…
          </p>
        ) : (
          <FuelProductRail
            series={series}
            selectedId={selectedId}
            onSelect={handleSelect}
            visibleIds={visibleIds}
            onToggleVisible={toggleVisible}
          />
        )}
      </HudPanel>

      <HudPanel
        index={2}
        title="WYKRES // SERIA CZASOWA"
        rightSlot={
          <span className="font-mono text-[9px] text-muted-foreground">
            {series.reduce((sum, s) => sum + s.points.length, 0)} punktów
          </span>
        }
        className="p-5 @max-[420px]:p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Chips
            options={RANGES}
            value={range}
            onChange={(next) => setRange(next)}
            ariaLabel="Zakres czasu"
          />
          <Chips
            options={MODES}
            value={mode}
            onChange={(next) => setMode(next)}
            ariaLabel="Tryb wykresu"
          />
          <button
            type="button"
            aria-pressed={showBrent}
            onClick={() => setShowBrent((v) => !v)}
            className={`font-display rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest transition ${
              showBrent
                ? "border-primary bg-primary/15 text-primary"
                : "border-primary/25 text-muted-foreground hover:bg-primary/10"
            }`}
          >
            ropa Brent
          </button>
        </div>

        <div className="mt-4">
          <FuelPriceChart
            series={series}
            visibleIds={visibleIds}
            primaryId={selectedId}
            mode={mode}
            overlay={overlayQuery.data}
            showBrent={showBrent}
          />
          <FuelChartLegend
            series={series}
            visibleIds={visibleIds}
            showBrent={showBrent}
            mode={mode}
          />
        </div>

        {mode === "spread" && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            Spread = cennik Orlenu minus koszt ropy przeliczony na PLN/m³. Rośnie, gdy marża i
            koszty przetwórstwa idą w górę.
          </p>
        )}
      </HudPanel>

      <div className="grid grid-cols-2 gap-6 @max-[900px]:grid-cols-1 @max-[420px]:gap-4">
        <HudPanel index={3} title="RYNEK // ROPA I KURS" tone="quiet">
          <MarketOverlayPanel overlay={overlayQuery.data} fuel={selected} />
        </HudPanel>

        <HudPanel index={4} title="PROGNOZA // 5 DNI" tone="quiet">
          <ForecastPanel forecast={forecastQuery.data} fuel={selected} />
        </HudPanel>
      </div>

      <HudPanel index={5} title="HEATMAPA // ZMIANY DZIENNE" tone="quiet">
        <ChangeHeatmap points={selected?.points ?? []} label={selected?.label ?? ""} />
      </HudPanel>

      <div className="grid grid-cols-2 gap-6 @max-[900px]:grid-cols-1 @max-[420px]:gap-4">
        <HudPanel
          index={6}
          title="ŚWIAT // CO RUSZA CENĄ"
          rightSlot={<LiveDot active={newsQuery.isFetching} label="RSS" />}
          tone="quiet"
          wrapperClassName="flex flex-col"
          className="flex min-h-0 flex-1 flex-col"
        >
          <FuelNewsPanel items={newsQuery.data ?? []} />
        </HudPanel>

        <HudPanel index={7} title="ALERTY // PROGI" tone="quiet">
          <FuelAlertsPanel
            alerts={alertsQuery.data ?? []}
            series={series}
            defaultProductId={selectedId}
          />
        </HudPanel>
      </div>

      <HudPanel
        index={8}
        title="DIAGNOSTYKA // ŹRÓDŁO"
        tone="quiet"
        className="p-5 @max-[420px]:p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="font-display inline-flex items-center gap-2 rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
          >
            <DatabaseBackup className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {backfillMutation.isPending ? "archiwizuję…" : "pełna archiwizacja od 2004"}
          </button>
          <p className="min-w-0 flex-1 break-words font-mono text-[10px] text-muted-foreground">
            Dane: publiczne API cennika hurtowego Orlenu (PLN/m³ netto), notowania Brent i kurs
            średni NBP. Dni bez publikacji są domykane ceną z ostatniego notowania. Jednorazowa
            archiwizacja pobiera ~26 tys. wierszy i trwa kilkanaście sekund.
          </p>
        </div>
      </HudPanel>
    </div>
  );
}
