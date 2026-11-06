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
import { Fold } from "./Fold";

// Klucz = źródło·horyzont (scoreboard.sourceKey) — 2 dni to gra bieżąca,
// 7 dni to kontrola i historia sprzed zmiany horyzontu.
const SOURCE_LABEL: Record<string, string> = {
  "signals·2": "Sygnały · 2 dni",
  "ai·2": "Model AI · 2 dni",
  "ai_learned·2": "AI + wnioski · 2 dni",
  "signals·7": "Sygnały · 7 dni",
  "ai·7": "Model AI · 7 dni",
  "ai_learned·7": "AI + wnioski · 7 dni",
};

/** Licznik dziennego budżetu tokenów modelu. */
function TokenMeter({ tokens }: { tokens: NonNullable<PredictionScoreboard["tokens"]> }) {
  const share = Math.min(1, tokens.used / tokens.limit);
  const color =
    share >= 0.9 ? "var(--destructive)" : share >= 0.7 ? "var(--warning)" : "var(--primary)";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
          Tokeny modelu dziś
        </span>
        <span className="font-mono text-[10px] text-foreground">
          {tokens.used.toLocaleString("pl-PL")} / {tokens.limit.toLocaleString("pl-PL")}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden bg-primary/10">
        <div className="h-full" style={{ width: `${share * 100}%`, background: color }} />
      </div>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground">
        prognozy{" "}
        {(tokens.byPurpose.forecast + tokens.byPurpose.forecast_learned).toLocaleString("pl-PL")} ·
        newsy {tokens.byPurpose.news.toLocaleString("pl-PL")} · alarmy{" "}
        {tokens.byPurpose.alarm.toLocaleString("pl-PL")} — po wyczerpaniu działa sama arytmetyka
      </p>
    </div>
  );
}

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
        {board.tokens && <TokenMeter tokens={board.tokens} />}
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
            Wg źródła
          </p>
          <div className="mt-1.5">
            <RateRows rows={board.bySource} labels={SOURCE_LABEL} meaningful={meaningful} />
          </div>
        </div>

        <p className="font-mono text-[10px] text-muted-foreground">
          Wnioski, z których korzysta „AI z wnioskami”: panel MÓZG AI powyżej.
        </p>
      </div>

      <Fold title="Szczegóły skuteczności" hint="kierunek · sytuacja · instrument">
        <div className="space-y-4">
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
              „Bez zmian” to ruch mniejszy niż pół typowego tygodniowego ruchu danego instrumentu
              (np. ±0,3% dla EURPLN, ±4% dla BTC), a wzrost lub spadek musi być co najmniej taki.
              Wtedy losowe zgadywanie daje ok. 33% — wszystko powyżej to realna wartość prognozy.
              Porównanie „Sygnały” vs „Model AI” odpowiada na pytanie, czy model bije prostą
              arytmetykę, a „Model AI” vs „Model AI + wnioski” — czy nauka z historii realnie
              podnosi trafność (test A/B: ten sam model i chwila, różnią się tylko wnioski).
            </>
          ) : (
            <>
              Za mało danych, żeby te liczby cokolwiek znaczyły — potrzeba co najmniej{" "}
              {board.minimumMeaningful} rozliczonych prognoz, jest {board.resolved}. Trafność
              liczona z kilku prognoz to przypadek, nie wynik, dlatego wartości są wyszarzone.
            </>
          )}
        </PanelHint>
      </Fold>
    </>
  );
}
