// The "CEO view" of /rynki: a few plain facts at the top (the fund's leader,
// how often the forecasts hit, the market today, the mood of the news) and the
// instrument list by category beside the chart. Pure: query data in, short
// lines out; nothing here is invented — no data, no line.

import type { AssetClass } from "@/lib/markets/assets";
import { isWaiting } from "@/lib/fund/verdict";
import type { PlayerKind } from "@/lib/fund/players";

// ---------------------------------------------------------------- list ----

/** Category tabs, in the order a person scans a market. */
export const CLASS_ORDER: readonly AssetClass[] = [
  "equity",
  "index",
  "etf",
  "crypto",
  "commodity",
  "fx",
];
export const CLASS_LABEL: Readonly<Record<AssetClass, string>> = {
  equity: "Akcje",
  index: "Indeksy",
  etf: "ETF",
  crypto: "Krypto",
  commodity: "Surowce",
  fx: "Waluty",
};

export type CatalogAsset = { symbol: string; label: string; assetClass: AssetClass };

export type ListRow = CatalogAsset & {
  watched: boolean;
  /** Last close and the change of the day; null until quotes are known. */
  last: number | null;
  change1d: number | null;
  currency: string | null;
};

/** The catalog grouped by category: watched first, then by name. Empty categories are left out. */
export function instrumentGroups(
  catalog: readonly CatalogAsset[],
  watched: ReadonlySet<string>,
  quotes: ReadonlyMap<string, { last: number | null; change1d: number | null; currency: string }>,
): Array<{ cls: AssetClass; label: string; rows: ListRow[] }> {
  return CLASS_ORDER.map((cls) => ({
    cls,
    label: CLASS_LABEL[cls],
    rows: catalog
      .filter((a) => a.assetClass === cls)
      .map((a) => {
        const q = quotes.get(a.symbol);
        return {
          ...a,
          watched: watched.has(a.symbol),
          last: q?.last ?? null,
          change1d: q?.change1d ?? null,
          currency: q?.currency ?? null,
        };
      })
      .sort(
        (x, y) => Number(y.watched) - Number(x.watched) || x.label.localeCompare(y.label, "pl"),
      ),
  })).filter((g) => g.rows.length > 0);
}

// ------------------------------------------------------------ headlines ----

/** The market today across the watched instruments: how many rose, fell, stood. */
export function breadth(
  series: ReadonlyArray<{ label: string; stats: { change1d: number | null } }>,
) {
  const known = series.filter(
    (s) => s.stats.change1d !== null && Number.isFinite(s.stats.change1d),
  );
  const up = known.filter((s) => (s.stats.change1d ?? 0) > 0).length;
  const down = known.filter((s) => (s.stats.change1d ?? 0) < 0).length;
  const ranked = [...known].sort((a, b) => (b.stats.change1d ?? 0) - (a.stats.change1d ?? 0));
  return {
    up,
    down,
    flat: known.length - up - down,
    known: known.length,
    top: ranked[0] ?? null,
    bottom: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  };
}

type FundPlayerLike = {
  key: string;
  label: string;
  kind: PlayerKind;
  metrics: { returnPct: number; trades: number; signals?: number } | null;
};

/**
 * The fund in one line: the best-playing forecaster since the start, and the
 * plain "buy and hold everything" basket to measure it against.
 */
export function fundHeadline(players: readonly FundPlayerLike[] | undefined) {
  if (!players?.length) return null;
  const playing = players.filter((p) => p.kind === "source" && !isWaiting(p) && p.metrics);
  if (!playing.length) return null;
  const leader = [...playing].sort((a, b) => b.metrics!.returnPct - a.metrics!.returnPct)[0];
  const basket = players.find((p) => p.kind === "benchmark" && p.metrics);
  const basketPct = basket?.metrics?.returnPct ?? null;
  return {
    label: leader.label,
    returnPct: leader.metrics!.returnPct,
    basketPct,
    beatsBasket: basketPct === null ? null : leader.metrics!.returnPct > basketPct,
  };
}

/** Score-board rows keyed source·horizon (scoreboard.sourceKey). */
const SOURCE_NAME: Readonly<Record<string, string>> = {
  ai_learned: "AI z wnioskami",
  ai: "AI",
  signals: "Sygnały",
};

/**
 * How often the forecasts hit, in words: the best forecaster of the current
 * game (2-day horizon) that has enough settled forecasts to mean anything.
 */
export function accuracyHeadline(
  board:
    | {
        bySource: ReadonlyArray<{ key: string; hitRate: number | null; resolved: number }>;
        minimumMeaningful: number;
      }
    | undefined,
) {
  if (!board) return null;
  const rows = board.bySource
    .filter((r) => r.key.endsWith("·2") && r.hitRate !== null)
    .map((r) => ({ ...r, name: SOURCE_NAME[r.key.split("·")[0]] ?? r.key }));
  const meaningful = rows.filter((r) => r.resolved >= board.minimumMeaningful);
  if (!meaningful.length) {
    const total = rows.reduce((s, r) => s + r.resolved, 0);
    return { meaningful: false as const, settled: total, needed: board.minimumMeaningful };
  }
  const best = [...meaningful].sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0))[0];
  return {
    meaningful: true as const,
    name: best.name,
    hitRate: best.hitRate!,
    /** "trafia 4 na 10" */
    outOfTen: Math.round((best.hitRate ?? 0) / 10),
    resolved: best.resolved,
  };
}

/** The mood of the news: how many items lean up, down, or neither. */
export function newsMood(
  items: ReadonlyArray<{ impact: "bullish" | "bearish" | "neutral" }> | undefined,
) {
  if (!items?.length) return null;
  const up = items.filter((i) => i.impact === "bullish").length;
  const down = items.filter((i) => i.impact === "bearish").length;
  return {
    up,
    down,
    neutral: items.length - up - down,
    lean:
      up > down * 1.25
        ? ("up" as const)
        : down > up * 1.25
          ? ("down" as const)
          : ("mixed" as const),
  };
}
