// Strumień newsów z oceną wpływu na obserwowane instrumenty.
//
// Kierunek („w górę"/„w dół") dotyczy ZAWSZE instrumentów wypisanych przy
// nagłówku, nigdy nastroju rynku ogólnie — ten sam news bywa dobry dla
// złota i zły dla akcji. Panel pokazuje te symbole przy każdej pozycji
// właśnie po to, żeby tej dwuznaczności nie dało się przeoczyć.
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Minus,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import type { MarketNewsItem } from "@/lib/markets/news";

const IMPACT_STYLE = {
  bullish: { color: "var(--success)", Icon: ArrowUpRight, label: "w górę" },
  bearish: { color: "var(--destructive)", Icon: ArrowDownRight, label: "w dół" },
  neutral: { color: "var(--muted-foreground)", Icon: Minus, label: "neutralnie" },
} as const;

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMin = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(diffMin)) return "—";
  if (diffMin < 60) return `${Math.max(diffMin, 0)} min temu`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return `${Math.round(hours / 24)} dni temu`;
}

export function MarketNewsPanel({
  items,
  aiCount,
  errors,
  filterSymbol,
  onClearFilter,
}: {
  items: MarketNewsItem[];
  aiCount: number;
  /** Powody pustego zaciągu — puste, gdy strumień działa. */
  errors: string[];
  filterSymbol: string | null;
  onClearFilter: () => void;
}) {
  if (items.length === 0) {
    // „Brak newsów" bez powodu wygląda identycznie jak „jeszcze się nie
    // zaciągnęły", a to dwie różne sytuacje — jedna wymaga czekania, druga
    // naprawy. Skoro serwer zna przyczynę, panel ma ją pokazać.
    if (!filterSymbol && errors.length > 0) {
      return (
        <div className="mt-3 space-y-1.5">
          <div className="flex min-w-0 items-start gap-2">
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--warning)" }}
            />
            <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              Zaciąg newsów nie przyniósł nic
            </p>
          </div>
          {errors.map((err) => (
            <p
              key={err}
              className="min-w-0 break-words pl-5 font-mono text-[10px] leading-relaxed text-muted-foreground"
            >
              {err}
            </p>
          ))}
          <PanelHint>
            Kanały RSS są pobierane przez serwer aplikacji. Najczęstsza przyczyna to blokada ruchu
            po adresie IP hostingu albo chwilowa niedostępność Google News — pełne komunikaty
            trafiają też do System Logs. Moduł ponowi próbę przy kolejnym odświeżeniu.
          </PanelHint>
        </div>
      );
    }
    return (
      <EmptyState>
        {filterSymbol ? `Brak newsów dla ${filterSymbol}` : "Brak newsów — poczekaj na zaciąg"}
      </EmptyState>
    );
  }

  return (
    <>
      {filterSymbol && (
        <div className="mt-3 flex items-center gap-2">
          <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">
            Filtr: {filterSymbol}
          </span>
          <button
            type="button"
            onClick={onClearFilter}
            className="font-display border border-primary/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            POKAŻ WSZYSTKIE
          </button>
        </div>
      )}

      <div className="no-scrollbar mt-3 max-h-[420px] space-y-2 overflow-x-hidden overflow-y-auto">
        {items.map((item) => {
          const style = IMPACT_STYLE[item.impact];
          return (
            <a
              key={item.guid}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block min-w-0 border-b border-primary/10 pb-2 last:border-b-0 hover:bg-primary/5"
            >
              <div className="flex min-w-0 items-start gap-2">
                <style.Icon
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: style.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 break-words text-xs leading-snug text-foreground">
                    {item.title}
                  </p>

                  {item.summaryPl && (
                    <p className="mt-0.5 min-w-0 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {item.summaryPl}
                    </p>
                  )}

                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className="font-display text-[9px] uppercase tracking-widest"
                      style={{ color: style.color }}
                    >
                      {style.label} · {item.impactScore}
                    </span>
                    {item.symbols.length > 0 ? (
                      item.symbols.map((s) => (
                        <span
                          key={s}
                          className="font-mono rounded border border-primary/30 px-1 text-[9px] text-primary"
                        >
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="font-mono text-[9px] text-muted-foreground/70">
                        ogólnorynkowy
                      </span>
                    )}
                    {item.classifiedBy === "ai" && (
                      <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary/70" />
                    )}
                    <span className="font-mono ml-auto shrink-0 text-[9px] text-muted-foreground/70">
                      {item.source ?? ""} · {relativeTime(item.publishedAt)}
                    </span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>

      <PanelHint>
        {aiCount > 0
          ? `Ocena wpływu: ${aiCount} z ${items.length} pozycji opisanych przez model, reszta heurystyką słownikową.`
          : "Ocena wpływu z heurystyki słownikowej — dodaj klucz Claude lub Gemini w Ustawieniach, aby dostać streszczenia po polsku."}{" "}
        Kierunek dotyczy instrumentów wypisanych przy nagłówku, nie nastroju rynku ogólnie. To
        podsumowanie tego, co napisano — nie prognoza ceny.
      </PanelHint>
    </>
  );
}
