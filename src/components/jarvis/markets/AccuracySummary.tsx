// Accuracy in plain words: for each forecaster of the current game (2-day
// forecasts), how many of 10 forecasts hit, with a bar and the sample size.
// The full score board stays below, folded.

import type { PredictionScoreboard } from "@/lib/markets/markets.functions";

const SOURCES: Array<{ key: string; name: string }> = [
  { key: "ai_learned·2", name: "AI z wnioskami" },
  { key: "ai·2", name: "AI" },
  { key: "signals·2", name: "Sygnały techniczne" },
];

export function AccuracySummary({ board }: { board: PredictionScoreboard }) {
  const rows = SOURCES.map((s) => ({
    ...s,
    row: board.bySource.find((r) => r.key === s.key) ?? null,
  }));
  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-relaxed text-foreground/85">
        Trafienie = cena poszła w kierunku, który wskazała prognoza, w ciągu 2 dni. Wynik liczy się
        dopiero od {board.minimumMeaningful} rozliczonych prognoz — wcześniej to przypadek.
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map(({ key, name, row }) => {
          const enough = (row?.resolved ?? 0) >= board.minimumMeaningful;
          const rate = row?.hitRate ?? null;
          return (
            <li key={key} className="min-w-0">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="font-display min-w-0 truncate text-[11px] uppercase tracking-[0.16em]">
                  {name}
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums">
                  {rate === null ? (
                    <span className="text-muted-foreground">brak rozliczeń</span>
                  ) : enough ? (
                    <>
                      trafia <b className="text-foreground">{Math.round(rate / 10)} na 10</b>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      za mało danych ({row?.resolved}/{board.minimumMeaningful})
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-primary/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${rate ?? 0}%`,
                    background: enough ? "var(--primary)" : "var(--muted-foreground)",
                    boxShadow: enough ? "0 0 8px var(--primary)" : undefined,
                    opacity: enough ? 1 : 0.5,
                  }}
                />
              </div>
              {row && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {row.hits} trafionych z {row.resolved} rozliczonych
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
