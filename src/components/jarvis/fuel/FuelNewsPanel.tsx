// Świat, który rusza cennikiem: nagłówki z kilku kanałów, każdy z oceną
// kierunku wpływu i jednozdaniowym streszczeniem po polsku.
//
// Kierunek NIE jest komunikowany samym kolorem — obok kropki stoi etykieta
// („W GÓRĘ" / „W DÓŁ" / „NEUTRALNY"), więc informacja przechodzi też przy
// daltonizmie i w druku.
import { useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { pl } from "date-fns/locale";
import { ExternalLink, Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { FuelNewsItem } from "@/lib/fuel/fuel.functions";
import type { Impact } from "@/lib/fuel/news";
import { cn } from "@/lib/utils";
import { EmptyState, PanelHint } from "./chrome";

const IMPACT_META: Record<Impact, { label: string; color: string; Icon: typeof TrendingUp }> = {
  bullish: { label: "w górę", color: "var(--destructive)", Icon: TrendingUp },
  bearish: { label: "w dół", color: "var(--success)", Icon: TrendingDown },
  neutral: { label: "neutralny", color: "var(--muted-foreground)", Icon: Minus },
};

type Filter = "all" | Impact;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "wszystko" },
  { value: "bullish", label: "w górę" },
  { value: "bearish", label: "w dół" },
  { value: "neutral", label: "neutralne" },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: pl });
}

function NewsRow({ item }: { item: FuelNewsItem }) {
  const meta = IMPACT_META[item.impact ?? "neutral"];
  return (
    <li className="min-w-0 border-l-2 py-2 pl-3" style={{ borderColor: meta.color }}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          className="font-display inline-flex items-center gap-1 text-[8px] uppercase tracking-[0.2em]"
          style={{ color: meta.color }}
        >
          <meta.Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
          {meta.label}
          {item.impactScore !== null && (
            <span className="font-mono text-[9px] text-muted-foreground">{item.impactScore}</span>
          )}
        </span>
        {item.source && (
          <span className="font-display min-w-0 truncate text-[8px] uppercase tracking-[0.15em] text-primary/70">
            {item.source}
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {relativeTime(item.publishedAt)}
        </span>
        {item.classifiedBy === "gemini" && (
          <Sparkles className="h-3 w-3 text-primary/60" strokeWidth={2} aria-label="ocena AI" />
        )}
      </div>

      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-0.5 flex min-w-0 items-start gap-1.5"
      >
        <span className="min-w-0 break-words text-xs font-medium text-foreground/90 group-hover:text-primary">
          {item.title}
        </span>
        <ExternalLink
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary"
          strokeWidth={2}
          aria-hidden
        />
      </a>

      {item.summaryPl && (
        <p className="mt-0.5 min-w-0 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
          {item.summaryPl}
        </p>
      )}
    </li>
  );
}

export function FuelNewsPanel({ items }: { items: FuelNewsItem[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Impact, number> = { bullish: 0, bearish: 0, neutral: 0 };
    for (const item of items) c[item.impact ?? "neutral"] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => (i.impact ?? "neutral") === filter)),
    [items, filter],
  );

  const aiCount = items.filter((i) => i.classifiedBy === "gemini").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-5 @max-[420px]:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const count = f.value === "all" ? items.length : counts[f.value];
          if (f.value !== "all" && count === 0) return null;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "font-display rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest transition",
                filter === f.value
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-primary/25 text-muted-foreground hover:bg-primary/10",
              )}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Brak newsów w tym filtrze</EmptyState>
      ) : (
        <ul className="no-scrollbar mt-3 max-h-[26rem] min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {filtered.map((item) => (
            <NewsRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      <PanelHint>
        {aiCount > 0
          ? `Ocena wpływu: ${aiCount} z ${items.length} pozycji opisanych przez Gemini, reszta heurystyką słownikową.`
          : "Ocena wpływu z heurystyki słownikowej — dodaj klucz Gemini w Ustawieniach, aby dostać streszczenia po polsku."}{" "}
        Kierunek dotyczy ceny paliwa, nie nastrojów rynkowych.
      </PanelHint>
    </div>
  );
}
