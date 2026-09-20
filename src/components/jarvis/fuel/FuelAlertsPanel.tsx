// Progi alertów: „powiadom mnie, gdy ON skoczy o 50 PLN/m³ w dobę".
//
// Alerty są sprawdzane w dwóch miejscach i to jest celowe: nocny job
// (scripts/orlen-daily.ts) wstawia wiersz do `notifications`, więc dzwonek
// zapala się nawet przy zamkniętej karcie — a ten panel sprawdza je jeszcze
// raz lokalnie, żeby przekroczenie zauważone podczas odświeżenia dało
// natychmiastowy sygnał, bez czekania na następny przebieg harmonogramu.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Trash2 } from "lucide-react";
import { audio } from "@/lib/audio/AudioEngine";
import { ORLEN_PRODUCTS } from "@/lib/fuel/orlen";
import {
  deleteFuelAlert,
  saveFuelAlert,
  type FuelAlert,
  type FuelSeries,
} from "@/lib/fuel/fuel.functions";
import { cn } from "@/lib/utils";
import { PanelHint } from "./chrome";
import { formatPln, formatSigned } from "./format";

const KIND_LABEL: Record<FuelAlert["kind"], string> = {
  daily_change_abs: "skok dobowy ≥",
  level_above: "cena ≥",
  level_below: "cena ≤",
};

type Hit = { alertId: string; message: string; description: string };

/** Zwraca alerty, których próg jest przekroczony w bieżących danych. */
function evaluate(alerts: FuelAlert[], series: FuelSeries[]): Hit[] {
  const hits: Hit[] = [];
  for (const alert of alerts) {
    if (!alert.isEnabled) continue;
    const fuel = series.find((s) => s.productId === alert.productId);
    const latest = fuel?.stats.latest;
    if (!fuel || latest === null || latest === undefined) continue;

    const change = fuel.stats.changeDay ?? 0;
    const triggered =
      alert.kind === "daily_change_abs"
        ? Math.abs(change) >= alert.threshold
        : alert.kind === "level_above"
          ? latest >= alert.threshold
          : latest <= alert.threshold;

    if (triggered) {
      hits.push({
        alertId: alert.id,
        message: `${fuel.label}: próg przekroczony`,
        description:
          alert.kind === "daily_change_abs"
            ? `Zmiana dobowa ${formatSigned(change)} PLN/m³ (próg ${formatPln(alert.threshold)}).`
            : `Cena ${formatPln(latest)} PLN/m³ (próg ${KIND_LABEL[alert.kind]} ${formatPln(alert.threshold)}).`,
      });
    }
  }
  return hits;
}

export function FuelAlertsPanel({
  alerts,
  series,
  defaultProductId,
}: {
  alerts: FuelAlert[];
  series: FuelSeries[];
  defaultProductId: number;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveFuelAlert);
  const remove = useServerFn(deleteFuelAlert);

  const [productId, setProductId] = useState(defaultProductId);
  const [kind, setKind] = useState<FuelAlert["kind"]>("daily_change_abs");
  const [threshold, setThreshold] = useState("50");

  // Jedno powiadomienie na alert na sesję przeglądania — bez tego każde
  // odświeżenie co 5 minut wywalałoby ten sam toast w kółko.
  const announced = useRef<Set<string>>(new Set());

  const hits = useMemo(() => evaluate(alerts, series), [alerts, series]);

  useEffect(() => {
    for (const hit of hits) {
      if (announced.current.has(hit.alertId)) continue;
      announced.current.add(hit.alertId);
      toast(hit.message, { description: hit.description });
      audio.playAccessGranted();
    }
  }, [hits]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fuel", "alerts"] });

  const saveMutation = useMutation({
    mutationFn: (input: { productId: number; kind: FuelAlert["kind"]; threshold: number }) =>
      save({ data: { ...input, isEnabled: true } }),
    onSuccess: () => {
      void invalidate();
      toast("Próg zapisany");
    },
    onError: (err: unknown) =>
      toast("Nie udało się zapisać progu", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_result, id) => {
      announced.current.delete(id);
      void invalidate();
    },
  });

  const parsedThreshold = Number(threshold.replace(",", "."));
  const canSave = Number.isFinite(parsedThreshold) && parsedThreshold > 0;

  return (
    <div className="p-5 @max-[420px]:p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          saveMutation.mutate({ productId, kind, threshold: parsedThreshold });
        }}
      >
        <label className="min-w-0 flex-1 basis-40">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            paliwo
          </span>
          <select
            value={productId}
            onChange={(e) => setProductId(Number(e.target.value))}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          >
            {ORLEN_PRODUCTS.map((p) => (
              <option key={p.id} value={p.id} className="bg-popover">
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 flex-1 basis-40">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            warunek
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as FuelAlert["kind"])}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          >
            {(Object.keys(KIND_LABEL) as FuelAlert["kind"][]).map((k) => (
              <option key={k} value={k} className="bg-popover">
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 basis-28">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            próg (PLN/m³)
          </span>
          <input
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          />
        </label>

        <button
          type="submit"
          disabled={!canSave || saveMutation.isPending}
          className="font-display rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
        >
          {saveMutation.isPending ? "zapisuję…" : "dodaj próg"}
        </button>
      </form>

      {alerts.length === 0 ? (
        <PanelHint>
          Brak progów. Typowy punkt startu: skok dobowy ≥ 50 PLN/m³ na ON Ekodieslu.
        </PanelHint>
      ) : (
        <ul className="no-scrollbar mt-4 max-h-56 space-y-1.5 overflow-y-auto overflow-x-hidden">
          {alerts.map((alert) => {
            const fuel = ORLEN_PRODUCTS.find((p) => p.id === alert.productId);
            const active = hits.some((h) => h.alertId === alert.id);
            return (
              <li
                key={alert.id}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded border px-2.5 py-1.5",
                  active
                    ? "border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10"
                    : "border-primary/20",
                )}
              >
                <BellRing
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: active ? "var(--warning)" : "var(--muted-foreground)" }}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
                  {fuel?.label ?? `#${alert.productId}`} · {KIND_LABEL[alert.kind]}{" "}
                  {formatPln(alert.threshold)}
                </span>
                {active && (
                  <span className="font-display shrink-0 text-[8px] uppercase tracking-[0.2em] text-[color:var(--warning)]">
                    aktywny
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(alert.id)}
                  aria-label="Usuń próg"
                  className="shrink-0 text-muted-foreground transition hover:text-[color:var(--destructive)]"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PanelHint>
        Progi sprawdza też nocny job — powiadomienie trafia wtedy na dzwonek JARVISa, nawet gdy ta
        karta jest zamknięta.
      </PanelHint>
    </div>
  );
}
