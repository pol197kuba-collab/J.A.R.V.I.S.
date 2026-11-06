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
import { useMemo, useState } from "react";
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { cn } from "@/lib/utils";
import type { AssetClass } from "@/lib/markets/assets";
import {
  feedLabel,
  newsClasses,
  type FeedHealth,
  type MarketImpact,
  type MarketNewsItem,
} from "@/lib/markets/news";
import { CLASS_LABEL, CLASS_ORDER } from "./marketsDigest";
import { Fold } from "./Fold";

const IMPACT_STYLE = {
  bullish: { color: "var(--success)", Icon: ArrowUpRight, label: "w górę" },
  bearish: { color: "var(--destructive)", Icon: ArrowDownRight, label: "w dół" },
  neutral: { color: "var(--muted-foreground)", Icon: Minus, label: "neutralnie" },
} as const;

const IMPACT_FILTER: ReadonlyArray<{ id: MarketImpact; label: string }> = [
  { id: "bullish", label: "Wzrostowe" },
  { id: "bearish", label: "Spadkowe" },
  { id: "neutral", label: "Neutralne" },
];

const FEED_STATUS = {
  ok: { color: "var(--success)", label: "działa" },
  quiet: { color: "var(--warning)", label: "cicho > 48 h" },
  none: { color: "var(--destructive)", label: "nic przez 7 dni" },
} as const;

/** One row of filter chips: „Wszystkie” + options, each with its count. */
function FilterRow<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T | null;
  options: ReadonlyArray<{ id: T; label: string; count: number }>;
  onChange: (v: T | null) => void;
}) {
  const chip = (active: boolean) =>
    cn(
      "font-display shrink-0 rounded px-2 py-1 text-[9px] uppercase tracking-[0.16em] transition-colors",
      active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div
      role="group"
      aria-label={name}
      className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden"
    >
      <span className="font-display mr-1 shrink-0 text-[8px] uppercase tracking-[0.22em] text-muted-foreground/70">
        {name}
      </span>
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={chip(value === null)}
      >
        Wszystkie
      </button>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={o.count === 0 && value !== o.id}
          onClick={() => onChange(value === o.id ? null : o.id)}
          className={cn(chip(value === o.id), "disabled:opacity-35")}
        >
          {o.label}
          <span className="ml-1 text-muted-foreground/70">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

function FeedList({ feeds }: { feeds: readonly FeedHealth[] }) {
  return (
    <ul className="space-y-1">
      {feeds.map((f) => {
        const st = FEED_STATUS[f.status];
        return (
          <li key={f.tag} className="flex min-w-0 items-center gap-2 text-[11px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: st.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground/85">{f.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {f.count7d} / 7 dni · {f.lastAt ? relativeTime(f.lastAt) : st.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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
  feeds = [],
}: {
  items: MarketNewsItem[];
  aiCount: number;
  /** Powody pustego zaciągu — puste, gdy strumień działa. */
  errors: string[];
  filterSymbol: string | null;
  onClearFilter: () => void;
  /** Stan kanałów RSS z ostatnich 7 dni. */
  feeds?: readonly FeedHealth[];
}) {
  const [cls, setCls] = useState<AssetClass | null>(null);
  const [impact, setImpact] = useState<MarketImpact | null>(null);
  const withClasses = useMemo(
    () => items.map((item) => ({ item, classes: newsClasses(item) })),
    [items],
  );
  // liczniki: klasa liczy się w obrębie wybranego wpływu i odwrotnie
  const classOptions = CLASS_ORDER.map((c) => ({
    id: c,
    label: CLASS_LABEL[c],
    count: withClasses.filter((x) => x.classes.includes(c) && (!impact || x.item.impact === impact))
      .length,
  }));
  const impactOptions = IMPACT_FILTER.map((o) => ({
    ...o,
    count: withClasses.filter((x) => x.item.impact === o.id && (!cls || x.classes.includes(cls)))
      .length,
  }));
  const shown = withClasses
    .filter((x) => (!cls || x.classes.includes(cls)) && (!impact || x.item.impact === impact))
    .map((x) => x.item);
  const sources =
    feeds.length > 0 ? (
      <Fold
        title="Źródła newsów"
        hint={`${feeds.filter((f) => f.status === "ok").length} z ${feeds.length} działa`}
      >
        <FeedList feeds={feeds} />
        <PanelHint>
          Licznik z bazy: ile newsów z kanału wjechało w ostatnich 7 dniach. „Cicho” bywa normalne
          (komunikaty Fed / EBC wychodzą rzadko); „nic przez 7 dni” = kanał nie odpowiada z serwera
          — szczegóły w System Logs.
        </PanelHint>
      </Fold>
    ) : null;

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
            po adresie IP hostingu albo chwilowa niedostępność kanału — pełne komunikaty trafiają
            też do System Logs. Moduł ponowi próbę przy kolejnym odświeżeniu.
          </PanelHint>
          {sources}
        </div>
      );
    }
    return (
      <>
        <EmptyState>
          {filterSymbol ? `Brak newsów dla ${filterSymbol}` : "Brak newsów — poczekaj na zaciąg"}
        </EmptyState>
        {sources}
      </>
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

      <div className="mt-3 space-y-1.5">
        <FilterRow name="Klasa" value={cls} options={classOptions} onChange={setCls} />
        <FilterRow name="Wpływ" value={impact} options={impactOptions} onChange={setImpact} />
      </div>

      {shown.length === 0 && (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">
          Nic dla tych filtrów — wybierz „Wszystkie” w którymś rzędzie.
        </p>
      )}
      <div className="no-scrollbar mt-3 max-h-[420px] space-y-2 overflow-x-hidden overflow-y-auto">
        {shown.map((item) => {
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
                      {item.source ?? feedLabel(item.feedTag)} · {relativeTime(item.publishedAt)}
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
      {sources}
    </>
  );
}
