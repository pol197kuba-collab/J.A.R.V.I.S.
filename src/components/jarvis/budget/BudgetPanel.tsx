// BUDŻET // ZUŻYCIE — ile poszło w tym miesiącu i na co.
//
// PANEL MÓWI, ŻE TO SZACUNEK, I ROBI TO NA WIERZCHU. Liczby powstają z pól
// `usage` zwróconych przez dostawcę, przeliczonych po cenniku wpisanym
// ręcznie. Rachunek w konsoli dostawcy będzie się różnił. Kwota, która tego
// nie mówi, zaczyna być traktowana jak wyciąg bankowy — a to narzędzie do
// odpowiadania na pytanie „dlaczego dziś trzy razy więcej niż wczoraj".
//
// NAJWAŻNIEJSZA RUBRYKA TO NIE SUMA, TYLKO ROZBICIE. Suma mówi, czy jest
// źle; rozbicie mówi, co z tym zrobić.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { PanelHint } from "@/components/jarvis/fuel/chrome";
import { getBudgetReport, type SpendRow } from "@/lib/agents/budget.functions";
import { formatUsd } from "@/lib/agents/pricing";
import { cn } from "@/lib/utils";

const LEVEL_COLOR: Record<string, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  over: "var(--destructive)",
};

function SpendList({ title, rows, total }: { title: string; rows: SpendRow[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <section className="min-w-0">
      <h3 className="font-display text-[9px] uppercase tracking-[0.25em] text-primary">{title}</h3>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => {
          // Udział liczymy z sumy pozycji pokazanych na liście, nie z limitu —
          // pasek ma odpowiadać na „ile z tego, co wydano", a nie mieszać
          // dwóch różnych odniesień w jednym widoku.
          const share = total > 0 ? (row.costUsd / total) * 100 : 0;
          return (
            <li key={row.key} className="min-w-0">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-foreground/90">
                  {row.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-foreground/70">
                  {formatUsd(row.costUsd)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary/10">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(100, share)}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[8px] text-muted-foreground">
                  {row.runs}×
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BudgetPanel({ index = 0 }: { index?: number }) {
  const fetchReport = useServerFn(getBudgetReport);
  const report = useQuery({
    queryKey: ["budget", "report"],
    queryFn: () => fetchReport(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const data = report.data ?? null;
  const color = data ? (LEVEL_COLOR[data.level] ?? "var(--primary)") : "var(--primary)";
  const pct = data && data.limitUsd > 0 ? Math.round(data.ratio * 100) : null;

  return (
    <HudPanel
      index={index}
      title="BUDŻET // ZUŻYCIE"
      tone="quiet"
      className="p-0"
      rightSlot={
        data && data.level !== "ok" ? (
          <span
            className="font-display flex shrink-0 items-center gap-1.5 text-[8px] uppercase tracking-[0.25em]"
            style={{ color }}
          >
            {data.level === "over" ? (
              <TrendingDown className="h-3 w-3" strokeWidth={2} aria-hidden />
            ) : (
              <AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />
            )}
            {data.level === "over" ? "tańsze modele" : "blisko limitu"}
          </span>
        ) : null
      }
    >
      <div className="p-5 @max-[420px]:p-4">
        {report.isLoading ? (
          <p className="font-mono text-[11px] text-muted-foreground">Liczę…</p>
        ) : !data ? (
          <p className="font-mono text-[11px] text-muted-foreground">Brak danych.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="font-display text-[22px] leading-none @max-[380px]:text-[18px]"
                  style={{ color }}
                >
                  {formatUsd(data.spentUsd)}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  w tym miesiącu · {data.runs} przebiegów
                  {data.limitUsd > 0 && ` · limit ${formatUsd(data.limitUsd)}`}
                </p>
              </div>
              <p className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                dziś {formatUsd(data.todayUsd)}
              </p>
            </div>

            {data.limitUsd > 0 && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-primary/10">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${Math.min(100, (data.ratio || 0) * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            )}
            {pct !== null && (
              <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                {pct}% limitu
                {data.level === "over" &&
                  " · agenci pracują na tańszych modelach do końca miesiąca"}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-5 @max-[520px]:grid-cols-1">
              <SpendList title="Wg modelu" rows={data.byModel} total={data.spentUsd} />
              <SpendList title="Wg agenta" rows={data.byAgent} total={data.spentUsd} />
            </div>

            {data.unpricedRuns > 0 && (
              <p
                className={cn(
                  "mt-4 min-w-0 break-words rounded border px-2.5 py-1.5",
                  "border-[color:var(--warning)]/30 bg-[color:var(--warning)]/5",
                  "font-mono text-[10px] leading-relaxed text-muted-foreground",
                )}
              >
                {data.unpricedRuns} przebiegów bez stawki w cenniku — nie są wliczone w sumę.
                Pominięte świadomie: policzenie ich jako zera zaniżyłoby budżet.
              </p>
            )}

            <PanelHint>
              Szacunek z pól zużycia zwróconych przez dostawców, po cenniku z{" "}
              {data.pricingVerifiedOn}. Rachunek w konsoli dostawcy będzie się różnił — to narzędzie
              do wyłapywania, co pochłania najwięcej, nie do rozliczeń co do centa.
            </PanelHint>
          </>
        )}
      </div>
    </HudPanel>
  );
}
