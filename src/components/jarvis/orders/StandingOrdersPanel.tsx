// STAŁE ROZKAZY — panel wspólny dla /rynki i /paliwa.
//
// Jeden komponent na oba moduły, bo rozkaz jest jeden: różni się wyłącznie
// słownikiem przedmiotów i jednostką, a jedno i drugie przychodzi z
// src/lib/orders/subjects.ts. Dwa bliźniacze panele znaczyłyby dwie listy
// warunków do utrzymania i nieuchronnie dwa różne słowa na to samo.
//
// PODGLĄD NA ŻYWO. Meldunki wysyła nocny job — ale panel dostaje też bieżące
// serie i zaznacza rozkazy, których warunek JEST właśnie spełniony. Ocenia je
// tym samym `evaluateOrder`, którym ocenia je job (z pominięciem wyciszenia,
// bo to podgląd, nie meldunek), więc nie ma tu drugiej, własnej arytmetyki,
// która mogłaby z czasem rozjechać się z tamtą.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Trash2 } from "lucide-react";
import { audio } from "@/lib/audio/AudioEngine";
import {
  createStandingOrder,
  deleteStandingOrder,
  toggleStandingOrder,
  type StandingOrderView,
} from "@/lib/orders/orders.functions";
import { evaluateOrder, type OrderCondition, type SeriesPoint } from "@/lib/orders/rules";
import { listSubjects } from "@/lib/orders/subjects";
import type { SubjectKind } from "@/lib/orders/rules";
import { cn } from "@/lib/utils";
import { PanelHint } from "@/components/jarvis/fuel/chrome";

/** Warunki w kolejności, w jakiej się o nich myśli, a nie alfabetycznie. */
const CONDITION_LABEL: Record<OrderCondition, string> = {
  level_below: "cena spadnie poniżej",
  level_above: "cena wzrośnie powyżej",
  change_pct_down: "spadek o [%]",
  change_pct_up: "wzrost o [%]",
  change_abs: "ruch o [jednostki]",
};

const CONDITION_ORDER: OrderCondition[] = [
  "level_below",
  "level_above",
  "change_pct_down",
  "change_pct_up",
  "change_abs",
];

/** Czy warunek liczy się z okna, czy z samej bieżącej ceny. */
const usesWindow = (condition: OrderCondition): boolean =>
  condition !== "level_below" && condition !== "level_above";

export function StandingOrdersPanel({
  subjectKind,
  orders,
  seriesBySubject,
  defaultSubject,
  queryKey,
}: {
  subjectKind: SubjectKind;
  orders: StandingOrderView[];
  /** Bieżące serie do podglądu „warunek spełniony teraz"; klucz = przedmiot. */
  seriesBySubject?: Record<string, SeriesPoint[]>;
  defaultSubject?: string;
  /** Klucz react-query do unieważnienia po zmianie. */
  queryKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const create = useServerFn(createStandingOrder);
  const remove = useServerFn(deleteStandingOrder);
  const toggle = useServerFn(toggleStandingOrder);

  const subjects = useMemo(
    () => listSubjects().filter((s) => s.kind === subjectKind),
    [subjectKind],
  );

  const [subject, setSubject] = useState(defaultSubject ?? subjects[0]?.id ?? "");
  const [condition, setCondition] = useState<OrderCondition>("change_pct_down");
  const [threshold, setThreshold] = useState("5");
  const [windowDays, setWindowDays] = useState("1");

  const unit = subjects.find((s) => s.id === subject)?.unit ?? "";

  // Które rozkazy są spełnione w tej chwili — do oznaczenia na liście.
  const activeIds = useMemo(() => {
    if (!seriesBySubject) return new Set<string>();
    const hits = new Set<string>();
    for (const order of orders) {
      const points = seriesBySubject[order.subject];
      if (!points || points.length === 0) continue;
      // Wyciszenie pomijamy: chodzi o stan świata, nie o to, czy meldunek
      // już poszedł.
      if (evaluateOrder({ ...order, lastTriggeredAt: null }, points)) hits.add(order.id);
    }
    return hits;
  }, [orders, seriesBySubject]);

  // Jeden sygnał na rozkaz na sesję — inaczej każde odświeżenie danych
  // wywalałoby ten sam komunikat w kółko.
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const order of orders) {
      if (!activeIds.has(order.id) || announced.current.has(order.id)) continue;
      announced.current.add(order.id);
      toast(`${order.label}: warunek spełniony`, { description: order.description });
      audio.playAccessGranted();
    }
  }, [activeIds, orders]);

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: (input: {
      subject: string;
      condition: OrderCondition;
      threshold: number;
      windowDays: number;
    }) => create({ data: { subjectKind, ...input } }),
    onSuccess: () => {
      void invalidate();
      toast("Rozkaz przyjęty");
    },
    onError: (err: unknown) =>
      toast("Nie udało się założyć rozkazu", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_r, id) => {
      announced.current.delete(id);
      void invalidate();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; isEnabled: boolean }) => toggle({ data: input }),
    onSuccess: () => void invalidate(),
  });

  const parsedThreshold = Number(threshold.replace(",", "."));
  const parsedWindow = Math.max(1, Math.min(90, Math.round(Number(windowDays) || 1)));
  const canSave = Number.isFinite(parsedThreshold) && parsedThreshold > 0 && subject !== "";

  return (
    <div className="p-5 @max-[420px]:p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          createMutation.mutate({
            subject,
            condition,
            threshold: parsedThreshold,
            windowDays: usesWindow(condition) ? parsedWindow : 1,
          });
        }}
      >
        <label className="min-w-0 flex-1 basis-40">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            {subjectKind === "market" ? "instrument" : "paliwo"}
          </span>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id} className="bg-popover">
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 flex-1 basis-44">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            warunek
          </span>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as OrderCondition)}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          >
            {CONDITION_ORDER.map((c) => (
              <option key={c} value={c} className="bg-popover">
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 basis-24">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            {condition === "change_pct_down" || condition === "change_pct_up"
              ? "próg (%)"
              : `próg (${unit})`}
          </span>
          <input
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
          />
        </label>

        {usesWindow(condition) && (
          <label className="min-w-0 basis-20">
            <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
              okno (dni)
            </span>
            <input
              inputMode="numeric"
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={!canSave || createMutation.isPending}
          className="font-display rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
        >
          {createMutation.isPending ? "zapisuję…" : "wydaj rozkaz"}
        </button>
      </form>

      {orders.length === 0 ? (
        <PanelHint>
          Brak rozkazów. Można je też wydać głosem: „powiadom mnie, gdy{" "}
          {subjectKind === "market"
            ? "Bitcoin spadnie o 5 procent"
            : "olej napędowy stanieje poniżej 5200"}
          ”.
        </PanelHint>
      ) : (
        <ul className="no-scrollbar mt-4 max-h-56 space-y-1.5 overflow-y-auto overflow-x-hidden">
          {orders.map((order) => {
            const active = activeIds.has(order.id);
            const expired = order.expiresAt !== null && Date.parse(order.expiresAt) <= Date.now();
            return (
              <li
                key={order.id}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded border px-2.5 py-1.5",
                  active
                    ? "border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10"
                    : "border-primary/20",
                  (!order.isEnabled || expired) && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    toggleMutation.mutate({ id: order.id, isEnabled: !order.isEnabled })
                  }
                  aria-label={order.isEnabled ? "Wycisz rozkaz" : "Włącz rozkaz"}
                  className="shrink-0 transition hover:text-primary"
                >
                  <BellRing
                    className="h-3.5 w-3.5"
                    style={{
                      color: active
                        ? "var(--warning)"
                        : order.isEnabled
                          ? "var(--muted-foreground)"
                          : "var(--muted)",
                    }}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>

                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
                  {order.description}
                </span>

                {expired ? (
                  <span className="font-display shrink-0 text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
                    wygasł
                  </span>
                ) : active ? (
                  <span className="font-display shrink-0 text-[8px] uppercase tracking-[0.2em] text-[color:var(--warning)]">
                    spełniony
                  </span>
                ) : order.triggerCount > 0 ? (
                  <span className="font-display shrink-0 text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
                    {order.triggerCount}×
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(order.id)}
                  aria-label="Odwołaj rozkaz"
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
        Rozkazy sprawdza nocny job — meldunek trafia na dzwonek JARVISa i na telefon, nawet gdy ta
        karta jest zamknięta. Powtórny meldunek z tego samego rozkazu nie przyjdzie częściej niż raz
        na dobę.
      </PanelHint>
    </div>
  );
}
