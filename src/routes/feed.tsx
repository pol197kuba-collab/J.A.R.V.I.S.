import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  XCircle,
  FileOutput,
  Bell,
  CheckSquare,
  AlertTriangle,
  Rss,
} from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { cn } from "@/lib/utils";
import { getLivingFeed, type FeedItem, type FeedItemType } from "@/lib/feed/feed.functions";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "JARVIS // Feed" },
      {
        name: "description",
        content: "Living Feed — chronological log of everything J.A.R.V.I.S. and the team did.",
      },
    ],
  }),
  component: FeedPage,
});

type Range = 24 | 168 | 720;
const RANGES: { hours: Range; label: string }[] = [
  { hours: 24, label: "24H" },
  { hours: 168, label: "7D" },
  { hours: 720, label: "30D" },
];

const TYPE_META: Record<FeedItemType, { label: string; icon: typeof CheckCircle2 }> = {
  run: { label: "Uruchomienia", icon: CheckCircle2 },
  file: { label: "Pliki", icon: FileOutput },
  notification: { label: "Powiadomienia", icon: Bell },
  task: { label: "Zadania", icon: CheckSquare },
  issue: { label: "Problemy", icon: AlertTriangle },
};

const TONE_COLOR: Record<FeedItem["tone"], string> = {
  success: "var(--success)",
  info: "var(--primary)",
  warning: "var(--warning)",
  error: "var(--destructive)",
};

function iconFor(item: FeedItem) {
  if (item.type === "run") return item.tone === "error" ? XCircle : CheckCircle2;
  return TYPE_META[item.type].icon;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "DZIŚ";
  if (sameDay(d, yesterday)) return "WCZORAJ";
  return d
    .toLocaleDateString("pl-PL", { day: "2-digit", month: "long", year: "numeric" })
    .toUpperCase();
}

function FeedRow({ item }: { item: FeedItem }) {
  const Icon = iconFor(item);
  const color = TONE_COLOR[item.tone];
  return (
    <div className="flex min-w-0 gap-3 border-l-2 py-2 pl-3" style={{ borderColor: color }}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-xs font-semibold uppercase tracking-widest text-foreground/90">
            {item.title}
          </span>
          {item.agent && (
            <span className="font-display text-[9px] uppercase tracking-[0.15em] text-primary/70">
              {item.agent}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            {timeOf(item.timestamp)}
          </span>
        </div>
        {item.detail && (
          <p className="mt-0.5 min-w-0 break-words font-mono text-[11px] text-muted-foreground">
            {item.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function FeedPage() {
  const fetchFeed = useServerFn(getLivingFeed);
  const [range, setRange] = useState<Range>(24);
  const [typeFilter, setTypeFilter] = useState<FeedItemType | "all">("all");

  const { data: items = [], isFetching } = useQuery({
    queryKey: ["feed", range],
    queryFn: () => fetchFeed({ data: { hours: range, limit: 200 } }),
    refetchInterval: 15_000,
  });

  const filtered = useMemo(
    () => (typeFilter === "all" ? items : items.filter((i) => i.type === typeFilter)),
    [items, typeFilter],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, FeedItem[]>();
    for (const item of filtered) {
      const key = dayLabel(item.timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()];
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Partial<Record<FeedItemType, number>> = {};
    for (const item of items) c[item.type] = (c[item.type] ?? 0) + 1;
    return c;
  }, [items]);

  return (
    <div className="space-y-6 p-6">
      <HudPanel
        index={0}
        title="LIVING FEED // CO SIĘ DZIAŁO"
        rightSlot={
          <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-primary">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-[color:var(--success)]",
                isFetching && "animate-pulse",
              )}
            />
            LIVE
          </span>
        }
        className="p-5"
      >
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">FEED</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Chronologiczny dziennik: uruchomienia agentów, wygenerowane pliki, powiadomienia,
          ukończone zadania i błędy — w jednym miejscu.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded border border-primary/25">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                type="button"
                onClick={() => setRange(r.hours)}
                className={cn(
                  "px-2.5 py-1 font-display text-[9px] uppercase tracking-widest transition",
                  range === r.hours
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-primary/10",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={cn(
                "font-display rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest transition",
                typeFilter === "all"
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-primary/25 text-muted-foreground hover:bg-primary/10",
              )}
            >
              wszystko ({items.length})
            </button>
            {(Object.keys(TYPE_META) as FeedItemType[]).map((t) => {
              const meta = TYPE_META[t];
              const count = counts[t] ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "font-display flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest transition",
                    typeFilter === t
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-primary/25 text-muted-foreground hover:bg-primary/10",
                  )}
                >
                  <meta.icon className="h-3 w-3" strokeWidth={1.75} />
                  {meta.label} ({count})
                </button>
              );
            })}
          </div>
        </div>
      </HudPanel>

      <HudPanel index={1} tone="quiet" title="OŚ CZASU" className="p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <Rss className="h-6 w-6 opacity-40" strokeWidth={1.5} />
            <p className="text-xs">Brak zdarzeń w wybranym oknie czasowym.</p>
          </div>
        ) : (
          <div className="no-scrollbar max-h-[70vh] min-h-0 space-y-5 overflow-y-auto overflow-x-hidden pr-1">
            {grouped.map(([day, dayItems]) => (
              <div key={day}>
                <p className="font-display sticky top-0 mb-1.5 bg-[color:var(--surface-1)] py-1 text-[10px] uppercase tracking-[0.3em] text-primary/70">
                  {day}
                </p>
                <div className="space-y-0.5">
                  {dayItems.map((item) => (
                    <FeedRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </HudPanel>
    </div>
  );
}
