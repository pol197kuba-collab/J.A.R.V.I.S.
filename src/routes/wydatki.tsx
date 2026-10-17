// WYDATKI (PLAN.md, S4.2) — paragony zeskanowane w Vision jako wydatki:
// suma miesiąca, podział na kategorie, trend 6 miesięcy i lista paragonów.
// Wydatki powstają wyłącznie z zatwierdzonego skanu („Zapisz” w Vision);
// ta strona je czyta, rozkłada na kategorie i pozwala usunąć.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ScanLine } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { EmptyState, PanelHint, StatTile } from "@/components/jarvis/fuel/chrome";
import { directionColor, formatPct, formatPln } from "@/components/jarvis/fuel/format";
import { ExpenseList } from "@/components/jarvis/expenses/ExpenseList";
import { TREND_MONTHS, deleteExpense, getExpenses } from "@/lib/expenses/expenses.functions";
import {
  changePct,
  monthLabel,
  monthOf,
  monthShort,
  monthlyTotals,
  shiftMonth,
  summarizeMonth,
} from "@/lib/expenses/summary";
import { CATEGORY_LABEL } from "@/lib/vision/modes";

export const Route = createFileRoute("/wydatki")({
  head: () => ({
    meta: [
      { title: "JARVIS // Wydatki" },
      {
        name: "description",
        content: "Wydatki z paragonów zeskanowanych w Vision: sumy miesięczne i kategorie.",
      },
    ],
  }),
  component: ExpensesPage,
});

// Shared with VisionScanner: the mode it opens in.
const VISION_MODE_KEY = "jarvis_vision_mode";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const zl = (v: number) => `${formatPln(v, 2)} zł`;

function ExpensesPage() {
  const [month, setMonth] = useState(thisMonth);
  const current = thisMonth();
  const fetchExpenses = useServerFn(getExpenses);
  const removeExpense = useServerFn(deleteExpense);
  const qc = useQueryClient();
  const { go } = useHudNavigate();

  const query = useQuery({
    queryKey: ["expenses", month],
    queryFn: () => fetchExpenses({ data: { month } }),
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const summary = useMemo(() => summarizeMonth(rows, month), [rows, month]);
  const trend = useMemo(() => monthlyTotals(rows, month, TREND_MONTHS), [rows, month]);
  const prevTotal = trend[trend.length - 2]?.total ?? 0;
  const change = changePct(summary.total, prevTotal);
  const monthRows = rows.filter((r) => monthOf(r.spentOn) === month);

  const del = useMutation({
    mutationFn: (id: string) => removeExpense({ data: { id } }),
    onSuccess: () => {
      toast.success("Wydatek usunięty");
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const scanReceipt = () => {
    try {
      window.localStorage.setItem(VISION_MODE_KEY, "receipt");
    } catch {
      /* ignore */
    }
    go("/vision");
  };

  const maxCat = Math.max(1, ...summary.categories.map((c) => Math.abs(c.amount)));
  const maxMonth = Math.max(1, ...trend.map((t) => t.total));

  return (
    <div className="space-y-6 p-6 @max-[420px]:space-y-4 @max-[420px]:p-4">
      <HudPanel
        index={0}
        title="WYDATKI // MIESIĄC"
        tone="elevated"
        className="p-5 @max-[420px]:p-4"
        rightSlot={
          <button
            type="button"
            onClick={scanReceipt}
            className="font-display flex items-center gap-1.5 border border-primary/50 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/15"
          >
            <ScanLine className="h-3 w-3" strokeWidth={2} />
            Skanuj paragon
          </button>
        }
      >
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label="Poprzedni miesiąc"
            className="grid h-8 w-8 place-items-center border border-primary/40 text-primary transition hover:bg-primary/10"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <p className="font-display min-w-0 truncate text-center text-sm uppercase tracking-[0.3em] text-primary @max-[380px]:text-xs @max-[380px]:tracking-[0.15em]">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= current}
            aria-label="Następny miesiąc"
            className="grid h-8 w-8 place-items-center border border-primary/40 text-primary transition hover:bg-primary/10 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 @max-[420px]:grid-cols-2 @max-[420px]:gap-3">
          <StatTile label="Suma" value={formatPln(summary.total, 2)} unit="zł" />
          <StatTile label="Paragony" value={String(summary.count)} />
          <StatTile
            label="vs poprzedni"
            value={change === null ? "—" : formatPct(change)}
            color={change === null ? undefined : directionColor(change)}
            hint={`${monthShort(shiftMonth(month, -1))}: ${zl(prevTotal)}`}
          />
        </div>
        {summary.other.length > 0 && (
          <PanelHint>
            Poza sumą (inna waluta):{" "}
            {summary.other
              .map((o) => `${formatPln(o.total, 2)} ${o.currency} (${o.count})`)
              .join(", ")}
            .
          </PanelHint>
        )}
      </HudPanel>

      <div className="grid grid-cols-2 gap-6 @max-[720px]:grid-cols-1 @max-[420px]:gap-4">
        <HudPanel index={1} title="KATEGORIE" tone="quiet" className="p-5 @max-[420px]:p-4">
          {summary.categories.length === 0 ? (
            <EmptyState>Brak wydatków w tym miesiącu</EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {summary.categories.map((c) => (
                <li key={c.category} className="min-w-0">
                  <div className="flex min-w-0 items-baseline justify-between gap-2 font-mono text-[11px]">
                    <span className="truncate text-foreground/90">
                      {CATEGORY_LABEL[c.category]}
                    </span>
                    <span className="shrink-0 text-foreground">
                      {zl(c.amount)}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {summary.total > 0 ? Math.round((c.amount / summary.total) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full bg-primary/10">
                    <div
                      className="h-full rounded-r-[2px]"
                      style={{
                        width: `${Math.max(0, (c.amount / maxCat) * 100)}%`,
                        background: "var(--primary)",
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {summary.merchants.length > 0 && (
            <PanelHint>
              Najwięcej:{" "}
              {summary.merchants
                .slice(0, 3)
                .map((m) => `${m.merchant} ${zl(m.amount)}`)
                .join(" · ")}
            </PanelHint>
          )}
        </HudPanel>

        <HudPanel
          index={2}
          title={`OSTATNIE ${TREND_MONTHS} MIESIĘCY`}
          tone="quiet"
          className="p-5 @max-[420px]:p-4"
        >
          <div className="flex h-36 items-end gap-2 @max-[380px]:gap-1">
            {trend.map((t) => {
              const active = t.month === month;
              return (
                <button
                  key={t.month}
                  type="button"
                  onClick={() => setMonth(t.month)}
                  title={`${monthLabel(t.month)}: ${zl(t.total)}`}
                  aria-label={`${monthLabel(t.month)}: ${zl(t.total)}`}
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <span className="font-mono text-[9px] text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 @max-[380px]:hidden">
                    {formatPln(t.total, 0)}
                  </span>
                  <span className="flex min-h-0 w-full flex-1 items-end justify-center">
                    <span
                      className="w-full max-w-10 rounded-t-[4px] transition"
                      style={{
                        height: `${Math.max(t.total > 0 ? 3 : 1, (t.total / maxMonth) * 100)}%`,
                        background: active
                          ? "var(--primary)"
                          : "color-mix(in oklab, var(--primary) 35%, transparent)",
                        boxShadow: active ? "var(--glow-primary)" : undefined,
                      }}
                    />
                  </span>
                  <span
                    className={`font-display text-[9px] uppercase tracking-wider ${active ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {monthShort(t.month)}
                  </span>
                </button>
              );
            })}
          </div>
          <PanelHint>Kliknij słupek, żeby przejść do miesiąca. Sumy tylko w złotówkach.</PanelHint>
        </HudPanel>
      </div>

      <HudPanel index={3} title="PARAGONY" tone="quiet" className="p-5 @max-[420px]:p-4">
        {query.isLoading ? (
          <EmptyState>Wczytuję wydatki…</EmptyState>
        ) : query.isError ? (
          <EmptyState>Nie udało się wczytać wydatków</EmptyState>
        ) : monthRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <EmptyState>Brak paragonów w tym miesiącu</EmptyState>
            <button
              type="button"
              onClick={scanReceipt}
              className="font-display flex items-center gap-2 border border-primary/50 px-3 py-2 text-[10px] uppercase tracking-[0.25em] text-primary transition hover:bg-primary/10"
            >
              <ScanLine className="h-4 w-4" strokeWidth={1.75} />
              Zeskanuj paragon
            </button>
          </div>
        ) : (
          <ExpenseList
            rows={monthRows}
            onDelete={(id) => del.mutate(id)}
            deletingId={del.isPending ? (del.variables ?? null) : null}
          />
        )}
      </HudPanel>
    </div>
  );
}
