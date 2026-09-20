// Wypadkowy wydźwięk newsów per instrument.
//
// Świadomie NIE jest to prognoza i panel mówi to wprost: pasek pokazuje, co
// o instrumencie napisano, a nie co się z nim stanie. Sygnały predykcyjne
// to osobna warstwa (etap 3) i będą liczone z cen, nie z nagłówków.
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import type { SymbolSentiment } from "@/lib/markets/news";

const toneFor = (score: number): string =>
  score > 15 ? "var(--success)" : score < -15 ? "var(--destructive)" : "var(--muted-foreground)";

export function SentimentPanel({
  rows,
  onSelect,
}: {
  rows: SymbolSentiment[];
  onSelect: (symbol: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState>Żaden news nie dotyczy obserwowanych instrumentów</EmptyState>;
  }

  return (
    <>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const asset = assetBySymbol(row.symbol);
          const tone = toneFor(row.score);
          // Pasek rozchodzi się od środka: lewo = negatywny, prawo =
          // pozytywny. Jedna oś, środek to zero — bez tego „50%" byłoby
          // nieczytelne (połowa czego?).
          const width = Math.min(Math.abs(row.score), 100) / 2;
          return (
            <button
              key={row.symbol}
              type="button"
              onClick={() => onSelect(row.symbol)}
              className="block w-full min-w-0 text-left"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-display min-w-0 flex-1 truncate text-[11px] uppercase tracking-widest text-foreground">
                  {asset?.label ?? row.symbol}
                </span>
                <span className="font-mono shrink-0 text-[10px]" style={{ color: tone }}>
                  {row.score > 0 ? "+" : ""}
                  {row.score}
                </span>
                <span className="font-mono shrink-0 text-[9px] text-muted-foreground/70">
                  {row.items} newsów
                </span>
              </div>
              <div className="relative mt-1 h-1.5 w-full rounded bg-primary/10">
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/30" />
                <span
                  className="absolute top-0 bottom-0 rounded"
                  style={{
                    background: tone,
                    width: `${width}%`,
                    left: row.score >= 0 ? "50%" : `${50 - width}%`,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <PanelHint>
        Wydźwięk ważony siłą wpływu — pięć ciekawostek nie równoważy jednej decyzji banku
        centralnego. To podsumowanie tonu newsów, NIE prognoza ceny. Kliknij instrument, aby
        odfiltrować newsy tylko jego dotyczące.
      </PanelHint>
    </>
  );
}
