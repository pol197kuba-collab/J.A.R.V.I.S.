// Panel „AUTO // KOSZT KILOMETRA” na /paliwa (S4.2): odczyty licznika ze
// skanów Vision → koszt km, spalanie i ostatnie tankowania. Kwota
// z dystrybutora ma pierwszeństwo; bez niej koszt to szacunek z hurtowej
// ceny Orlen ON i panel mówi otwarcie, jaka część to szacunek.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ScanLine, Trash2 } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { EmptyState, PanelHint, StatTile } from "./chrome";
import { formatDatePl, formatPln } from "./format";
import { deleteVehicleReading, getVehicleLog } from "@/lib/vehicle/vehicle.functions";
import { STATION_MARGIN_NET, priceOnOrBefore, vehicleStats } from "@/lib/vehicle/costs";

// Shared with VisionScanner: the mode it opens in.
const VISION_MODE_KEY = "jarvis_vision_mode";

export function VehicleCostPanel({ index }: { index: number }) {
  const fetchLog = useServerFn(getVehicleLog);
  const removeReading = useServerFn(deleteVehicleReading);
  const qc = useQueryClient();
  const { go } = useHudNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["vehicle-log"], queryFn: () => fetchLog() });
  const stats = useMemo(() => {
    if (!query.data) return null;
    return vehicleStats(query.data.readings, priceOnOrBefore(query.data.diesel));
  }, [query.data]);

  const del = useMutation({
    mutationFn: (id: string) => removeReading({ data: { id } }),
    onSuccess: () => {
      setConfirmId(null);
      void qc.invalidateQueries({ queryKey: ["vehicle-log"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const scanOdometer = () => {
    try {
      window.localStorage.setItem(VISION_MODE_KEY, "odometer");
    } catch {
      /* ignore */
    }
    go("/vision");
  };

  const readings = query.data?.readings ?? [];
  const bySegment = new Map(stats?.segments.map((s) => [s.reading.id, s]) ?? []);
  const estPct = stats ? Math.round(stats.estimatedShare * 100) : 0;

  return (
    <HudPanel
      index={index}
      title="AUTO // KOSZT KILOMETRA"
      tone="quiet"
      className="p-5 @max-[420px]:p-4"
      rightSlot={
        <button
          type="button"
          onClick={scanOdometer}
          className="font-display flex items-center gap-1.5 border border-primary/50 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/15"
        >
          <ScanLine className="h-3 w-3" strokeWidth={2} />
          Skanuj licznik
        </button>
      }
    >
      {query.isLoading ? (
        <EmptyState>Wczytuję dziennik auta…</EmptyState>
      ) : query.isError ? (
        <EmptyState>Nie udało się wczytać dziennika auta</EmptyState>
      ) : readings.length < 2 || !stats ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <EmptyState>
            {readings.length === 0
              ? "Brak odczytów licznika"
              : "Jeden odczyt — koszt km policzę po następnym tankowaniu"}
          </EmptyState>
          <PanelHint>
            Przy tankowaniu zeskanuj licznik w Vision (tryb „Licznik”) razem z dystrybutorem:
            przebieg, litry i kwota. Licz do pełna — wtedy koszt kilometra jest prawdziwy.
          </PanelHint>
        </div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-4 gap-4 @max-[560px]:grid-cols-2 @max-[420px]:gap-3">
            <StatTile
              label="Koszt km"
              value={stats.costPerKm === null ? "—" : formatPln(stats.costPerKm, 2)}
              unit="zł/km"
              hint={
                stats.costPerKm === null
                  ? "brak kwot i cen"
                  : `${formatPln(stats.costPerKm * 100, 0)} zł / 100 km`
              }
            />
            <StatTile
              label="Spalanie"
              value={stats.litersPer100 === null ? "—" : formatPln(stats.litersPer100, 1)}
              unit="l/100"
            />
            <StatTile
              label="Przejechane"
              value={formatPln(stats.distanceKm, 0)}
              unit="km"
              hint={`licznik ${formatPln(stats.lastKm, 0)} km`}
            />
            <StatTile
              label="Na paliwo"
              value={formatPln(stats.fuelCost, 0)}
              unit="zł"
              hint={estPct > 0 ? `w tym ~${estPct}% szacunek` : "same kwoty z dystrybutora"}
            />
          </div>

          <ul className="mt-4 divide-y divide-primary/10">
            {readings.slice(0, 6).map((r) => {
              const seg = bySegment.get(r.id);
              return (
                <li
                  key={r.id}
                  className="grid min-w-0 grid-cols-[4.5rem_1fr_auto_auto] items-center gap-3 py-2 font-mono text-[11px] @max-[420px]:grid-cols-[1fr_auto_auto] @max-[420px]:gap-2"
                >
                  <span className="text-muted-foreground @max-[420px]:hidden">
                    {formatDatePl(r.loggedOn).replace(/\s\d{4}$/, "")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">
                      {formatPln(r.odometerKm, 0)} km
                      {seg && <span className="text-muted-foreground"> · +{seg.km} km</span>}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      <span className="hidden @max-[420px]:inline">
                        {formatDatePl(r.loggedOn).replace(/\s\d{4}$/, "")} ·{" "}
                      </span>
                      {r.fuelLiters !== null ? `${formatPln(r.fuelLiters, 2)} l` : "bez tankowania"}
                    </span>
                  </span>
                  <span className="text-right text-foreground">
                    {r.amountPln !== null ? (
                      `${formatPln(r.amountPln, 2)} zł`
                    ) : seg?.costSource === "estimate" && seg.cost !== null ? (
                      <span title={`szacunek: ${formatPln(seg.pricePerL, 2)} zł/l`}>
                        ~{formatPln(seg.cost, 2)} zł
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                  {confirmId === r.id ? (
                    <button
                      type="button"
                      onClick={() => del.mutate(r.id)}
                      disabled={del.isPending}
                      className="font-display border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.15em] text-destructive"
                    >
                      Usuń?
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(r.id)}
                      aria-label="Usuń odczyt"
                      className="grid h-6 w-6 place-items-center text-muted-foreground transition hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <PanelHint>
            Metoda „do pełna”: tankowanie płaci za kilometry od poprzedniego tankowania. Bez kwoty
            liczę ~szacunek: hurt Orlen ON z dnia odczytu + {formatPln(STATION_MARGIN_NET, 2)} zł/l
            marży stacji + VAT.
          </PanelHint>
        </>
      )}
    </HudPanel>
  );
}
