// „Typer": ranking instrumentów wg siły sygnału, z przesłankami.
//
// Panel jest zaprojektowany tak, żeby NIE dało się go przeczytać jak
// rekomendacji: przy każdej pozycji stoi pewność, lista przesłanek (także
// tych przeciwnych) i informacja, czy werdykt modelu zgadza się z
// arytmetyką. Kierunek bez tego kontekstu byłby obietnicą, której moduł nie
// może złożyć.
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus, Sparkles } from "lucide-react";
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/markets/series";
import type { OutlookRow } from "@/lib/markets/markets.functions";

const DIRECTION = {
  up: { color: "var(--success)", Icon: ArrowUpRight, label: "może rosnąć" },
  down: { color: "var(--destructive)", Icon: ArrowDownRight, label: "może spadać" },
  flat: { color: "var(--muted-foreground)", Icon: Minus, label: "bez kierunku" },
} as const;

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1 w-full rounded bg-primary/10">
      <div
        className="h-1 rounded"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

export function OutlookPanel({
  rows,
  horizonDays,
  model,
}: {
  rows: OutlookRow[];
  horizonDays: number;
  model: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState>Za mało notowań, żeby policzyć sygnały</EmptyState>;
  }

  return (
    <>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const style = DIRECTION[row.direction];
          const open = expanded === row.symbol;
          // Rozjazd modelu z arytmetyką jest informacją, nie usterką —
          // pokazujemy go wprost zamiast wybierać jedną wersję po cichu.
          const disagrees = row.ai !== null && row.ai.direction !== row.direction;

          return (
            <div
              key={row.symbol}
              className={cn(
                "min-w-0 rounded border px-3 py-2 transition",
                open ? "border-primary/50 bg-primary/5" : "border-primary/20",
              )}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : row.symbol)}
                className="block w-full min-w-0 text-left"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <style.Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} />
                  <span className="font-display min-w-0 truncate text-[11px] uppercase tracking-widest text-foreground">
                    {row.label}
                  </span>
                  <span
                    className="font-display shrink-0 text-[9px] uppercase tracking-widest"
                    style={{ color: style.color }}
                  >
                    {style.label}
                  </span>
                  {row.ai && <Sparkles className="h-3 w-3 shrink-0 text-primary/70" />}
                  <ChevronDown
                    className={cn(
                      "ml-auto h-3 w-3 shrink-0 text-muted-foreground transition",
                      open && "rotate-180",
                    )}
                  />
                </div>

                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <span className="font-mono shrink-0 text-[10px] text-muted-foreground">
                    {formatPrice(row.lastPrice, row.currency)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <ConfidenceBar value={row.confidence} color={style.color} />
                  </span>
                  <span className="font-mono shrink-0 text-[10px] text-muted-foreground">
                    pewność {row.confidence}%
                  </span>
                </div>
              </button>

              {open && (
                <div className="mt-2 space-y-1.5 border-t border-primary/15 pt-2">
                  {row.drivers.slice(0, 5).map((driver) => (
                    <div key={driver.label} className="flex min-w-0 items-start gap-2">
                      <span
                        className="font-mono mt-0.5 w-10 shrink-0 text-right text-[10px]"
                        style={{
                          color:
                            driver.contribution > 0
                              ? "var(--success)"
                              : driver.contribution < 0
                                ? "var(--destructive)"
                                : "var(--muted-foreground)",
                        }}
                      >
                        {driver.contribution > 0 ? "+" : ""}
                        {driver.contribution.toFixed(0)}
                      </span>
                      <p className="min-w-0 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {driver.note}
                      </p>
                    </div>
                  ))}

                  {row.sentimentItems > 0 && (
                    <p className="min-w-0 break-words font-mono text-[10px] text-muted-foreground">
                      Newsy: wydźwięk {row.sentimentScore} z {row.sentimentItems} pozycji (waga 25%
                      wobec 75% dla notowań).
                    </p>
                  )}

                  {row.ai?.rationalePl && (
                    <p className="min-w-0 break-words font-mono text-[10px] leading-relaxed text-primary/80">
                      <Sparkles className="mr-1 inline h-2.5 w-2.5" />
                      {row.ai.rationalePl}
                    </p>
                  )}

                  {disagrees && row.ai && (
                    <p
                      className="min-w-0 break-words font-mono text-[10px]"
                      style={{ color: "var(--warning)" }}
                    >
                      Model widzi to inaczej niż sygnały ({DIRECTION[row.ai.direction].label},
                      pewność {row.ai.confidence}%). Obie wersje są zapisywane osobno i rozliczane
                      niezależnie.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PanelHint>
        Horyzont {horizonDays} dni. Ranking po SILE sygnału, nie po jego kierunku — najwyżej stoi
        to, co ma najwyraźniejsze przesłanki, w którąkolwiek stronę.{" "}
        {model ? `Interpretacja: ${model}.` : "Bez klucza AI — same sygnały techniczne."} Wskaźniki
        opisują przeszłość i nie wiedzą, co będzie; każda prognoza jest zapisywana i rozliczana, a
        wynik widać w panelu skuteczności. To nie jest rekomendacja inwestycyjna.
      </PanelHint>
    </>
  );
}
