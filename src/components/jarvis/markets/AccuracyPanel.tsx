// Panel skuteczności: czy ten „typer" w ogóle trafia.
//
// Świadomie pokazuje wynik razem z jego wiarygodnością. Trafność 100% z
// trzech prognoz to nie jest wynik, więc dopóki nie uzbiera się próg
// rozliczeń, panel mówi to wprost zamiast chwalić się liczbą.
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import type { PredictionScoreboard } from "@/lib/markets/markets.functions";
import type { ScoreRow } from "@/lib/markets/scoreboard";
import { REGIME_LABEL_PL } from "@/lib/markets/regime";

const SOURCE_LABEL: Record<string, string> = {
  signals: "Sygnały (arytmetyka)",
  ai: "Model AI",
  ai_learned: "Model AI + wnioski",
};

const DIRECTION_LABEL: Record<string, string> = {
  up: "Prognozy wzrostu",
  down: "Prognozy spadku",
  flat: "Prognozy „bez kierunku”",
};

// Punkt odniesienia to ~33%: pasmo „bez zmian" jest dobrane tak, że wzrost,
// spadek i brak ruchu są z góry mniej więcej równie prawdopodobne, więc tyle
// daje losowe zgadywanie. Poniżej tego typer jest gorszy niż rzut kością — i
// panel ma to pokazywać kolorem, a nie ukrywać.
const rateColor = (rate: number | null): string => {
  if (rate === null) return "var(--muted-foreground)";
  return rate >= 45 ? "var(--success)" : rate >= 35 ? "var(--warning)" : "var(--destructive)";
};

function RateRows({
  rows,
  labels,
  meaningful,
}: {
  rows: ScoreRow[];
  labels?: Record<string, string>;
  meaningful: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="font-mono text-[10px] text-muted-foreground/70">Brak rozliczonych prognoz.</p>
    );
  }
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-0 items-center gap-2">
          <span className="font-display min-w-0 flex-1 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
            {labels?.[row.key] ?? assetBySymbol(row.key)?.label ?? row.key}
          </span>
          <span
            className="font-mono shrink-0 text-[11px] font-bold"
            style={{ color: meaningful ? rateColor(row.hitRate) : "var(--muted-foreground)" }}
          >
            {row.hitRate === null ? "—" : `${row.hitRate.toFixed(0)}%`}
          </span>
          <span className="font-mono w-16 shrink-0 text-right text-[9px] text-muted-foreground/70">
            {row.hits}/{row.resolved}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AccuracyPanel({ board }: { board: PredictionScoreboard }) {
  if (board.resolved === 0 && board.pending === 0) {
    return (
      <EmptyState>Brak prognoz — pierwsze zapiszą się przy najbliższym przeliczeniu</EmptyState>
    );
  }

  const meaningful = board.resolved >= board.minimumMeaningful;

  return (
    <>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-[10px] text-muted-foreground">
            rozliczone: <span className="text-foreground">{board.resolved}</span>
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            oczekujące: <span className="text-foreground">{board.pending}</span>
          </span>
          {board.stale > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              pominięte kopie: {board.stale}
            </span>
          )}
          {board.justResolved > 0 && (
            <span className="font-mono text-[10px]" style={{ color: "var(--success)" }}>
              +{board.justResolved} rozliczono teraz
            </span>
          )}
        </div>

        <div>
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            Czego się nauczyłem
          </p>
          {board.lessons.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5">
              {board.lessons.map((lesson) => (
                <li
                  key={lesson.textPl}
                  className="min-w-0 break-words border-l-2 pl-2 text-[11px] leading-snug text-foreground/85"
                  style={{
                    borderColor:
                      lesson.kind === "direction"
                        ? "color-mix(in oklab, var(--warning) 70%, transparent)"
                        : "color-mix(in oklab, var(--primary) 50%, transparent)",
                  }}
                >
                  {lesson.textPl}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
              Jeszcze za mało rozliczonych prognoz — wniosek wymaga co najmniej 12 przypadków z
              dwóch różnych tygodni.
            </p>
          )}
        </div>

        <div>
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            Wg źródła
          </p>
          <div className="mt-1.5">
            <RateRows rows={board.bySource} labels={SOURCE_LABEL} meaningful={meaningful} />
          </div>
        </div>

        <div>
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            Wg kierunku
          </p>
          <div className="mt-1.5">
            <RateRows rows={board.byDirection} labels={DIRECTION_LABEL} meaningful={meaningful} />
          </div>
        </div>

        {board.byRegime.length > 0 && (
          <div>
            <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Wg sytuacji rynkowej
            </p>
            <div className="mt-1.5">
              <RateRows rows={board.byRegime} labels={REGIME_LABEL_PL} meaningful={meaningful} />
            </div>
          </div>
        )}

        {board.bySourceFixedBand.length > 0 && (
          <div>
            <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Dla porównania: stary próg ±1%
            </p>
            <div className="mt-1.5 opacity-70">
              <RateRows rows={board.bySourceFixedBand} labels={SOURCE_LABEL} meaningful={false} />
            </div>
          </div>
        )}

        {board.bySymbol.length > 0 && (
          <div>
            <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              Wg instrumentu
            </p>
            <div className="no-scrollbar mt-1.5 max-h-40 overflow-x-hidden overflow-y-auto">
              <RateRows rows={board.bySymbol.slice(0, 12)} meaningful={meaningful} />
            </div>
          </div>
        )}
      </div>

      <PanelHint>
        {meaningful ? (
          <>
            „Bez zmian” to ruch mniejszy niż pół typowego tygodniowego ruchu danego instrumentu (np.
            ±0,3% dla EURPLN, ±4% dla BTC), a wzrost lub spadek musi być co najmniej taki. Wtedy
            losowe zgadywanie daje ok. 33% — wszystko powyżej to realna wartość prognozy. Porównanie
            „Sygnały” vs „Model AI” odpowiada na pytanie, czy model bije prostą arytmetykę, a „Model
            AI” vs „Model AI + wnioski” — czy nauka z historii realnie podnosi trafność (test A/B:
            ten sam model i chwila, różnią się tylko wnioski).
          </>
        ) : (
          <>
            Za mało danych, żeby te liczby cokolwiek znaczyły — potrzeba co najmniej{" "}
            {board.minimumMeaningful} rozliczonych prognoz, jest {board.resolved}. Trafność liczona
            z kilku prognoz to przypadek, nie wynik, dlatego wartości są wyszarzone.
          </>
        )}
      </PanelHint>
    </>
  );
}
