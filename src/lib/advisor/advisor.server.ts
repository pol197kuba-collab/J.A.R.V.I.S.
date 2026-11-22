// DORADCA — dane z bazy → karty zagrań. Plik serwerowy (strona i joby).
//
// Szybko (0 tokenów): ostatnie prognozy czterech graczy, które jeszcze nie
// minęły, policzone na bieżącej cenie (notowania z taktu na żywo co 15 min).
// Głęboko: to samo, ale model ocenia instrumenty od nowa na teraz
// (buildOutlook z callModel) — BEZ zapisu prognoz, więc fundusz i trafność
// zostają nietknięte. Limit głębokich analiz dziennie, w budżecie tokenów.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { fetchAllPages } from "@/lib/db/paginate";
import { addDays, horizonEnd, type Direction } from "@/lib/fund/engine";
import { assetBySymbol, type MarketAsset } from "@/lib/markets/assets";
import type { PricePoint } from "@/lib/markets/series";
import {
  buildPlays,
  consensus,
  marketMood,
  parseAdvisorSettings,
  type AdvisorInstrument,
  type AdvisorPlayer,
  type AdvisorSettings,
  type MarketMood,
  type NewsRef,
  type Play,
  type Vote,
} from "./plan";
import { warsawClock } from "./alerts";

type Db = SupabaseClient<Database>;

/** Ile głębokich analiz dziennie (każda to jedno–dwa wywołania modelu). */
export const DEEP_PER_DAY = 3;
const VOTE_LOOKBACK_DAYS = 4;
const NEWS_LOOKBACK_H = 72;
const HISTORY_DAYS = 60;

export type AdvisorJournalEntry = {
  id: string;
  symbol: string;
  label: string;
  side: "buy" | "sell";
  action: "played" | "skipped";
  status: "open" | "closed";
  strength: number;
  entry: number;
  stop: number;
  take: number;
  expiresOn: string;
  lots: number | null;
  units: number | null;
  alerts: string[];
  closedReason: string | null;
  createdAt: string;
};

export type Advice = {
  generatedAt: string;
  mode: "quick" | "deep";
  /** Model, który ocenił instrumenty w głębokiej analizie; null = szybka. */
  model: string | null;
  mood: MarketMood;
  plays: Play[];
  settings: AdvisorSettings;
  deepLeft: number;
  journal: AdvisorJournalEntry[];
};

// ---------------------------------------------------------- ustawienia ----

type SettingsRow = { settings: AdvisorSettings; deep: { day: string; count: number } };

export async function loadAdvisorSettings(db: Db, ownerId: string): Promise<SettingsRow> {
  const { data, error } = await db
    .from("advisor_settings")
    .select("settings")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`advisor_settings: ${error.message}`);
  const raw = (data?.settings ?? {}) as Record<string, unknown>;
  const deepRaw = (raw.deepRuns ?? {}) as { day?: unknown; count?: unknown };
  return {
    settings: parseAdvisorSettings(raw),
    deep: {
      day: typeof deepRaw.day === "string" ? deepRaw.day : "",
      count: Number(deepRaw.count) || 0,
    },
  };
}

export async function saveAdvisorSettingsRow(
  db: Db,
  ownerId: string,
  settings: AdvisorSettings,
  deep: { day: string; count: number },
): Promise<void> {
  const { error } = await db.from("advisor_settings").upsert(
    {
      owner_id: ownerId,
      settings: { ...settings, deepRuns: deep } as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  if (error) throw new Error(`advisor_settings: ${error.message}`);
}

// ---------------------------------------------------------------- głosy ----

const playerOf = (source: string, horizon: number): AdvisorPlayer | null =>
  source === "ai" && horizon === 7
    ? "ai_7d"
    : horizon !== 2
      ? null
      : source === "ai" || source === "ai_learned" || source === "signals"
        ? source
        : null;

const isDir = (d: string): d is Direction => d === "up" || d === "down" || d === "flat";

type Context = { regime: string | null; technical: number | null; sentiment: number | null };

async function loadVotes(
  db: Db,
  ownerId: string,
  today: string,
): Promise<{ votes: Map<string, Vote[]>; context: Map<string, Context> }> {
  const since = `${addDays(today, -VOTE_LOOKBACK_DAYS)}T00:00:00Z`;
  const rows = await fetchAllPages<{
    symbol: string;
    source: string;
    horizon_days: number;
    direction: string;
    confidence: number;
    rationale_pl: string | null;
    made_at: string;
    regime: string | null;
    technical_score: number | null;
    sentiment_score: number | null;
    stale: boolean;
    id: string;
  }>((from, to) =>
    db
      .from("market_predictions")
      .select(
        "symbol, source, horizon_days, direction, confidence, rationale_pl, made_at, regime, technical_score, sentiment_score, stale, id",
      )
      .eq("owner_id", ownerId)
      .in("source", ["ai", "ai_learned", "signals"])
      .in("horizon_days", [2, 7])
      .gte("made_at", since)
      .order("made_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const votes = new Map<string, Vote[]>();
  const context = new Map<string, Context>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.stale || !isDir(r.direction)) continue;
    const player = playerOf(r.source, r.horizon_days);
    const asset = assetBySymbol(r.symbol);
    if (!player || !asset) continue;
    const key = `${r.symbol}|${player}`;
    if (seen.has(key)) continue; // najnowsza prognoza gracza wygrywa
    seen.add(key);
    // Prognoza, której horyzont minął, już nie głosuje.
    if (horizonEnd(r.made_at.slice(0, 10), r.horizon_days, asset.assetClass) < today) continue;
    const list = votes.get(r.symbol) ?? [];
    list.push({
      player,
      direction: r.direction,
      confidence: r.confidence,
      rationalePl: r.rationale_pl,
      madeAt: r.made_at,
    });
    votes.set(r.symbol, list);
    if (!context.has(r.symbol)) {
      context.set(r.symbol, {
        regime: r.regime,
        technical: r.technical_score,
        sentiment: r.sentiment_score,
      });
    }
  }
  return { votes, context };
}

// ---------------------------------------------------------------- ceny ----

async function loadPrices(db: Db, symbols: string[], today: string) {
  const closes = new Map<string, PricePoint[]>();
  const last = new Map<string, { price: number; at: string }>();
  if (symbols.length === 0) return { closes, last };
  const all = [...new Set(symbols)];
  const rows = await fetchAllPages<{
    symbol: string;
    quote_date: string;
    close: number;
    source: string;
    updated_at: string;
  }>((from, to) =>
    db
      .from("market_quotes")
      .select("symbol, quote_date, close, source, updated_at")
      .in("symbol", all)
      .gte("quote_date", addDays(today, -60))
      .order("quote_date", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, to),
  );
  for (const r of rows) {
    const close = Number(r.close);
    if (!(close > 0)) continue;
    const list = closes.get(r.symbol) ?? [];
    list.push({ date: r.quote_date, close });
    closes.set(r.symbol, list);
    last.set(r.symbol, { price: close, at: r.source === "live" ? r.updated_at : r.quote_date });
  }
  return { closes, last };
}

// ---------------------------------------------------------------- newsy ----

async function loadNews(db: Db, symbols: string[]): Promise<Map<string, NewsRef[]>> {
  const since = new Date(Date.now() - NEWS_LOOKBACK_H * 3_600_000).toISOString();
  const { data } = await db
    .from("market_news_items")
    .select("title, link, source, published_at, symbols, impact, impact_score, summary_pl")
    .overlaps("symbols", symbols)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(300);
  const out = new Map<string, Array<NewsRef & { score: number }>>();
  for (const n of data ?? []) {
    const impact =
      n.impact === "positive" || n.impact === "negative" ? n.impact : ("neutral" as const);
    for (const s of n.symbols ?? []) {
      if (!symbols.includes(s)) continue;
      const list = out.get(s) ?? [];
      list.push({
        title: n.title,
        link: n.link,
        source: n.source,
        publishedAt: n.published_at,
        impact,
        summaryPl: n.summary_pl,
        score: Math.abs(n.impact_score ?? 0),
      });
      out.set(s, list);
    }
  }
  const top = new Map<string, NewsRef[]>();
  for (const [s, list] of out) {
    top.set(
      s,
      list
        .sort(
          (a, b) => b.score - a.score || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
        )
        .slice(0, 4)
        .map(({ score: _score, ...n }) => n),
    );
  }
  return top;
}

// -------------------------------------------------------------- historia ----

/** Rozliczone prognozy AI z wnioskami (zapas: AI), 2 dni: trafność per klasa i kierunek. */
async function loadHistory(db: Db, ownerId: string, today: string) {
  const rows = await fetchAllPages<{
    symbol: string;
    source: string;
    direction: string;
    outcome: string | null;
    id: string;
  }>((from, to) =>
    db
      .from("market_predictions")
      .select("symbol, source, direction, outcome, id")
      .eq("owner_id", ownerId)
      .in("source", ["ai_learned", "ai"])
      .eq("horizon_days", 2)
      .eq("stale", false)
      .in("outcome", ["hit", "miss"])
      .gte("made_at", `${addDays(today, -HISTORY_DAYS)}T00:00:00Z`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const tally = (source: string) => {
    const m = new Map<string, { cases: number; hits: number }>();
    for (const r of rows) {
      if (r.source !== source) continue;
      const cls = assetBySymbol(r.symbol)?.assetClass;
      if (!cls) continue;
      const key = `${cls}|${r.direction}`;
      const t = m.get(key) ?? { cases: 0, hits: 0 };
      t.cases += 1;
      if (r.outcome === "hit") t.hits += 1;
      m.set(key, t);
    }
    return m;
  };
  const learned = tally("ai_learned");
  const ai = tally("ai");
  return (assetClass: string, direction: Direction) => {
    const key = `${assetClass}|${direction}`;
    const l = learned.get(key);
    return l && l.cases >= 5 ? l : (ai.get(key) ?? l ?? null);
  };
}

// ---------------------------------------------------------------- dziennik ----

export async function loadJournal(db: Db, ownerId: string, today: string) {
  const { data, error } = await db
    .from("advisor_journal")
    .select(
      "id, symbol, label, side, action, status, strength, entry_price, stop_price, take_price, expires_on, lots, units, alerts, closed_reason, created_at",
    )
    .eq("owner_id", ownerId)
    .or(`status.eq.open,created_at.gte.${addDays(today, -7)}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`advisor_journal: ${error.message}`);
  return (data ?? []).map(
    (r): AdvisorJournalEntry => ({
      id: r.id,
      symbol: r.symbol,
      label: r.label,
      side: r.side === "buy" ? "buy" : "sell",
      action: r.action === "played" ? "played" : "skipped",
      status: r.status === "open" ? "open" : "closed",
      strength: r.strength,
      entry: Number(r.entry_price),
      stop: Number(r.stop_price),
      take: Number(r.take_price),
      expiresOn: r.expires_on,
      lots: r.lots === null ? null : Number(r.lots),
      units: r.units === null ? null : Number(r.units),
      alerts: r.alerts ?? [],
      closedReason: r.closed_reason,
      createdAt: r.created_at,
    }),
  );
}

// ---------------------------------------------------------------- całość ----

export type ComputeOpts = {
  deep?: { anthropicApiKey: string | null; geminiApiKey: string | null } | null;
  /** Bez dziennika (joby go nie potrzebują). */
  withJournal?: boolean;
  now?: Date;
};

export async function computeAdvice(
  db: Db,
  ownerId: string,
  opts: ComputeOpts = {},
): Promise<Advice> {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const { settings, deep } = await loadAdvisorSettings(db, ownerId);
  const { votes, context } = await loadVotes(db, ownerId, today);

  let model: string | null = null;
  if (opts.deep) {
    const { buildOutlook } = await import("@/lib/markets/ingest.server");
    const scan = [...votes.keys()].map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));
    const outlook = await buildOutlook(db, ownerId, opts.deep, { scan, callModel: true });
    model = outlook.model;
    const at = now.toISOString();
    for (const r of outlook.rows) {
      const fresh: Vote[] = [
        {
          player: "signals",
          direction: r.direction,
          confidence: r.confidence,
          rationalePl: r.drivers[0]?.note ?? null,
          madeAt: at,
        },
      ];
      if (r.ai) {
        fresh.push({
          player: "ai",
          direction: r.ai.direction,
          confidence: r.ai.confidence,
          rationalePl: r.ai.rationalePl,
          madeAt: at,
        });
        if (r.ai.control) {
          fresh.push({
            player: "ai_7d",
            direction: r.ai.control.direction,
            confidence: r.ai.control.confidence,
            rationalePl: r.ai.rationalePl,
            madeAt: at,
          });
        }
      }
      if (r.aiLearned) {
        fresh.push({
          player: "ai_learned",
          direction: r.aiLearned.direction,
          confidence: r.aiLearned.confidence,
          rationalePl: r.aiLearned.rationalePl,
          madeAt: at,
        });
      }
      // Świeży głos gracza zastępuje jego starszy; reszta zostaje.
      const merged = new Map((votes.get(r.symbol) ?? []).map((v) => [v.player, v]));
      for (const v of fresh) merged.set(v.player, v);
      votes.set(r.symbol, [...merged.values()]);
      context.set(r.symbol, {
        regime: r.regime,
        technical: r.technicalScore,
        sentiment: r.sentimentScore,
      });
    }
  }

  const symbols = [...votes.keys()];
  const [{ closes, last }, news, history] = await Promise.all([
    loadPrices(db, symbols, today),
    loadNews(db, symbols),
    loadHistory(db, ownerId, today),
  ]);

  const instruments: AdvisorInstrument[] = symbols.flatMap((symbol) => {
    const asset = assetBySymbol(symbol);
    const px = last.get(symbol);
    if (!asset || !px) return [];
    const v = votes.get(symbol) ?? [];
    const c = consensus(v);
    const ctx = context.get(symbol);
    return [
      {
        symbol,
        label: asset.label,
        assetClass: asset.assetClass,
        currency: asset.currency,
        price: px.price,
        priceAt: px.at,
        closes: closes.get(symbol) ?? [],
        votes: v,
        regime: ctx?.regime ?? null,
        technicalScore: ctx?.technical ?? null,
        sentimentScore: ctx?.sentiment ?? null,
        news: news.get(symbol) ?? [],
        history: c.direction === "flat" ? null : history(asset.assetClass, c.direction),
      },
    ];
  });

  const day = warsawClock(now).day;
  return {
    generatedAt: now.toISOString(),
    mode: opts.deep ? "deep" : "quick",
    model,
    mood: marketMood(instruments),
    plays: buildPlays(instruments, settings, today),
    settings,
    deepLeft: Math.max(0, DEEP_PER_DAY - (deep.day === day ? deep.count : 0)),
    journal: opts.withJournal ? await loadJournal(db, ownerId, today) : [],
  };
}

/** Zgodność graczy per instrument, z ostatnich prognoz (do pilnowania pozycji). */
export async function currentConsensus(db: Db, ownerId: string, today: string) {
  const { votes } = await loadVotes(db, ownerId, today);
  return new Map([...votes].map(([s, v]) => [s, consensus(v)]));
}

/** Format ceny do powiadomień: ułamki dla tanich instrumentów, całe dla drogich. */
export function fmtPrice(v: number): string {
  const digits = v >= 1000 ? 0 : v >= 10 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
