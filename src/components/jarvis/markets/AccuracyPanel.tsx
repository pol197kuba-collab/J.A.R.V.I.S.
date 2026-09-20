// Panel skuteczności: czy ten „typer" w ogóle trafia.
//
// Świadomie pokazuje wynik razem z jego wiarygodnością. Trafność 100% z
// trzech prognoz to nie jest wynik, więc dopóki nie uzbiera się próg
// rozliczeń, panel mówi to wprost zamiast chwalić się liczbą.
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import type { PredictionScoreboard } from "@/lib/markets/markets.functions";
import type { ScoreRow } from "@/lib/markets/scoreboard";

const SOURCE_LABEL: Record<string, string> = {
  signals: "Sygnały (arytmetyka)",
  ai: "Model AI",
};

const DIRECTION_LABEL: Record<string, string> = {
  up: "Prognozy wzrostu",
  down: "Prognozy spadku",
  flat: "Prognozy „bez kierunku”",
};

// Trafność poniżej 50% dla prognoz kierunkowych jest gorsza niż rzut monetą
// — i panel ma to pokazywać kolorem, a nie ukrywać.
const rateColor = (rate: number | null): string => {
  if (rate === null) return "var(--muted-foreground)";
  return rate >= 60 ? "var(--success)" : rate >= 45 ? "var(--warning)" : "var(--destructive)";
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
          {board.justResolved > 0 && (
            <span className="font-mono text-[10px]" style={{ color: "var(--success)" }}>
              +{board.justResolved} rozliczono teraz
            </span>
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
            Prognoza wzrostu liczy się jako trafiona dopiero przy realnym ruchu o co najmniej 1% —
            sam brak spadku to za mało. Porównanie „Sygnały" vs „Model AI" odpowiada na jedyne
            pytanie, które ma tu znaczenie: czy model bije prostą arytmetykę.
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
