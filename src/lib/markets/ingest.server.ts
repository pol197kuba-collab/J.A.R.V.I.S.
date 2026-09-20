// MARKET GRID — rdzeń zaciągu: notowania, newsy, prognozy i ich
// rozliczanie. Plik serwerowy, świadomie NIEzależny od TanStacka.
//
// Istnieje dlatego, że ta sama praca musi dać się wykonać z dwóch miejsc:
// z server function (gdy ktoś wejdzie na /rynki) i z nocnego joba GitHub
// Actions (gdy nie wejdzie nikt). Trzymanie logiki w server functions
// zmuszałoby job do jej drugiej kopii — dokładnie ten sam powód, dla
// którego istnieje src/lib/fuel/ingest.server.ts.
//
// Dlatego każda funkcja tutaj bierze klienta Supabase i ownerId jako
// argumenty, zamiast czytać je z kontekstu żądania.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { assetBySymbol, DEFAULT_WATCHLIST, isKnownSymbol, type MarketAsset } from "./assets";
import { normalizeSeries, type PricePoint } from "./series";
import type { QuoteSource } from "./quotes.server";
import { aggregateSentiment, type MarketImpact, type MarketNewsItem } from "./news";
import {
  combineOutlook,
  computeSignals,
  scoreSignals,
  type SignalDirection,
  type SignalDriver,
} from "./signals";
import { percentChange, resolveOutcome, type PredictionDirection } from "./scoreboard";
import { fetchAllPages } from "@/lib/db/paginate";

/** Klient Supabase — sesja użytkownika albo service_role, zależnie od tego, kto woła. */
export type Db = SupabaseClient<Database>;

/** Klucze modeli. Server function bierze je z user_secrets, job ze środowiska. */
export type ModelKeys = {
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
};

// Notowania dzienne zmieniają się raz na sesję, więc częstsze odpytywanie
// darmowych API nic nie wnosi poza zużyciem limitu. Krypto chodzi 24/7,
// stąd krótszy próg dla niego.
const MIN_REFRESH_MS = 30 * 60_000;
const MIN_REFRESH_CRYPTO_MS = 10 * 60_000;

/** Ile dni do przodu dotyczy prognoza. Krótki horyzont da się rozliczyć. */
export const HORIZON_DAYS = 7;

// Świeżość per instrument, wspólna dla wszystkich czytelników w procesie.
const lastRefreshAt = new Map<string, number>();

const refreshThresholdFor = (asset: MarketAsset): number =>
  asset.assetClass === "crypto" ? MIN_REFRESH_CRYPTO_MS : MIN_REFRESH_MS;

export async function logEvent(
  supabase: Db,
  userId: string,
  level: "error" | "warn" | "info",
  message: string,
  meta: Json,
): Promise<void> {
  try {
    await supabase
      .from("system_events")
      .insert({ owner_id: userId, level, source: "market-grid", message, meta });
  } catch {
    // Logowanie nie ma prawa wysypać żądania ani przebiegu joba.
  }
}

export type OutlookRow = {
  symbol: string;
  label: string;
  assetClass: MarketAsset["assetClass"];
  currency: string;
  colorToken: string;
  lastPrice: number;
  /** Wypadkowa techniki i newsów, -100..100. */
  score: number;
  direction: SignalDirection;
  confidence: number;
  technicalScore: number;
  sentimentScore: number | null;
  sentimentItems: number;
  drivers: SignalDriver[];
  /** Werdykt modelu — null, gdy nie ma klucza albo model zawiódł. */
  ai: { direction: SignalDirection; confidence: number; rationalePl: string | null } | null;
};

// ---------------------------------------------------------- watchlista ----

/**
 * Watchlista użytkownika. Pusta tabela oznacza nowe konto, nie „użytkownik
 * wszystko usunął" — pierwsze wejście dostaje więc domyślny przekrój
 * rynków, zapisany na stałe, żeby dało się go potem edytować jak własny.
 */
export async function loadWatchlist(supabase: Db, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("market_watchlist")
    .select("symbol, position")
    .eq("owner_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const symbols = (data ?? []).map((r) => r.symbol).filter(isKnownSymbol);
  if (symbols.length > 0) return symbols;

  const seed = DEFAULT_WATCHLIST.map((symbol, position) => ({
    owner_id: userId,
    symbol,
    position,
  }));
  const { error: seedErr } = await supabase
    .from("market_watchlist")
    .upsert(seed, { onConflict: "owner_id,symbol" });
  if (seedErr) throw new Error(seedErr.message);
  return [...DEFAULT_WATCHLIST];
}

// ----------------------------------------------------------- notowania ----

async function persistSeries(
  supabase: Db,
  symbol: string,
  currency: string,
  source: QuoteSource,
  points: PricePoint[],
): Promise<void> {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    symbol,
    quote_date: p.date,
    close: p.close,
    currency,
    source,
  }));
  // Paczkami — jedno żądanie z tysiącem wierszy potrafi przekroczyć limit
  // payloadu PostgREST-a.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("market_quotes")
      .upsert(rows.slice(i, i + 500), { onConflict: "symbol,quote_date" });
    if (error) throw new Error(error.message);
  }
}

/**
 * Dociąga z API te instrumenty, których cache jest przeterminowany, i
 * zapisuje wynik. Nigdy nie rzuca w górę: awaria źródła ma zostawić ślad w
 * System Logs i pozwolić modułowi pokazać to, co już ma.
 */
export async function ingestQuotes(
  supabase: Db,
  userId: string,
  assets: MarketAsset[],
  days: number,
  force: boolean,
): Promise<{ didFetch: boolean; errors: Map<string, string> }> {
  const now = Date.now();
  const stale = assets.filter(
    (a) => force || now - (lastRefreshAt.get(a.symbol) ?? 0) > refreshThresholdFor(a),
  );
  const errors = new Map<string, string>();
  if (stale.length === 0) return { didFetch: false, errors };

  const { fetchManyAssetSeries } = await import("./quotes.server");
  const outcomes = await fetchManyAssetSeries(stale, days);

  for (const outcome of outcomes) {
    const asset = assetBySymbol(outcome.symbol);
    if (!asset) continue;
    if (!outcome.ok) {
      errors.set(outcome.symbol, outcome.error);
      await logEvent(supabase, userId, "warn", `Notowania ${asset.label}: ${outcome.error}`, {
        symbol: outcome.symbol,
      } as Json);
      continue;
    }
    try {
      await persistSeries(supabase, asset.symbol, asset.currency, outcome.source, outcome.points);
      // Znacznik stawiamy dopiero po udanym zapisie — inaczej nieudana
      // runda blokowałaby ponowną próbę na cały próg świeżości.
      lastRefreshAt.set(asset.symbol, Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.set(outcome.symbol, msg);
      await logEvent(supabase, userId, "error", `Zapis cache ${asset.label}: ${msg}`, {
        symbol: asset.symbol,
      } as Json);
    }
  }
  return { didFetch: true, errors };
}

// --------------------------------------------------------------- newsy ----

/**
 * Zaciąga kanały, ocenia wpływ i zapisuje do współdzielonego cache'u.
 * Nigdy nie rzuca w górę — padnięty kanał ma zostawić ślad w System Logs i
 * pozwolić pokazać to, co już jest w bazie.
 */
export async function ingestNews(
  supabase: Db,
  userId: string,
  assets: MarketAsset[],
  keys: ModelKeys,
): Promise<{ written: number; aiCount: number; errors: string[] }> {
  const { ingestMarketNews } = await import("./news.server");
  const { items, errors } = await ingestMarketNews(assets, keys);

  for (const err of errors) {
    await logEvent(supabase, userId, "warn", `Kanał newsów: ${err}`, {} as Json);
  }
  // Powód pustego zaciągu wraca do wywołującego, a nie tylko do logów:
  // „brak newsów" bez przyczyny wygląda identycznie jak „jeszcze się nie
  // zaciągnęły", a to dwie zupełnie różne sytuacje.
  if (items.length === 0) {
    return {
      written: 0,
      aiCount: 0,
      errors: errors.length > 0 ? errors : ["żaden kanał nie zwrócił pozycji"],
    };
  }

  // Upsert po guid: ten sam news wraca przy każdym zaciągu, a ponowna ocena
  // (np. po dodaniu klucza AI) ma poprawić wiersz, nie dołożyć drugi.
  const rows = items.map((i) => ({
    guid: i.guid,
    title: i.title,
    link: i.link,
    source: i.source,
    published_at: i.publishedAt,
    feed_tag: i.feedTag,
    symbols: i.symbols,
    impact: i.impact,
    impact_score: i.impactScore,
    summary_pl: i.summaryPl,
    classified_by: i.classifiedBy,
  }));
  const { error } = await supabase.from("market_news_items").upsert(rows, { onConflict: "guid" });
  if (error) {
    await logEvent(supabase, userId, "error", `Zapis newsów: ${error.message}`, {} as Json);
    return { written: 0, aiCount: 0, errors: [`zapis do bazy: ${error.message}`] };
  }
  return {
    written: items.length,
    aiCount: items.filter((i) => i.classifiedBy === "ai").length,
    errors,
  };
}

// ------------------------------------------------------------- typer ----

/**
 * Liczy sygnały dla całej watchlisty, prosi model o interpretację i zapisuje
 * obie wersje prognozy.
 *
 * Notowania bierze z cache'u, nie odświeża ich sam — od tego jest
 * ingestQuotes. Dzięki temu jedno wejście na stronę nie odpala dwudziestu
 * żądań do darmowych API, a nocny job może wykonać kroki w kontrolowanej
 * kolejności.
 */
export async function buildOutlook(
  supabase: Db,
  userId: string,
  keys: ModelKeys,
): Promise<{ rows: OutlookRow[]; model: string | null }> {
  const symbols = await loadWatchlist(supabase, userId);
  const assets = symbols.map(assetBySymbol).filter((a): a is MarketAsset => Boolean(a));

  // Notowania bierzemy z cache'u — typer nie odświeża danych sam, żeby
  // jedno kliknięcie nie odpalało dwudziestu żądań do darmowych API.
  // Świeżość zapewnia ingestQuotes — na stronie woła je getMarketGrid,
  // w nocnym jobie osobny krok przed tym.
  const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  // STRONICOWANE. Supabase oddaje maksymalnie 1000 wierszy na zapytanie i
  // robi to CICHO — `error` zostaje null, a nadmiar znika. Dwadzieścia
  // instrumentów razy 200 dni to ~4000 wierszy, więc bez tego sygnały
  // liczyłyby się z najstarszego wycinka historii i wyglądałyby wiarygodnie
  // mimo że opisują stan sprzed miesięcy. Moduł paliwowy przerobił dokładnie
  // tę awarię (patrz src/lib/db/paginate.ts).
  //
  // Sortowanie MUSI być jednoznaczne: sama data powtarza się dla każdego z
  // instrumentów, a przy niejednoznacznej kolejności strony potrafią gubić
  // i dublować wiersze.
  const quoteRows = await fetchAllPages<{ symbol: string; quote_date: string; close: number }>(
    (from, to) =>
      supabase
        .from("market_quotes")
        .select("symbol, quote_date, close")
        .in("symbol", symbols)
        .gte("quote_date", since)
        .order("quote_date", { ascending: true })
        .order("symbol", { ascending: true })
        .range(from, to),
  );

  const pointsBySymbol = new Map<string, PricePoint[]>();
  for (const row of quoteRows ?? []) {
    const bucket = pointsBySymbol.get(row.symbol) ?? [];
    bucket.push({ date: row.quote_date, close: Number(row.close) });
    pointsBySymbol.set(row.symbol, bucket);
  }

  // Wydźwięk i nagłówki z tego samego cache'u newsów, co panel etapu 2.
  const { data: newsRows } = await supabase
    .from("market_news_items")
    .select(
      "guid, title, link, source, published_at, feed_tag, symbols, impact, impact_score, summary_pl, classified_by",
    )
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(150);

  const news: MarketNewsItem[] = (newsRows ?? []).map((r) => ({
    guid: r.guid,
    title: r.title,
    link: r.link,
    source: r.source,
    publishedAt: r.published_at,
    feedTag: r.feed_tag ?? "",
    symbols: r.symbols ?? [],
    impact: (r.impact as MarketImpact | null) ?? "neutral",
    impactScore: r.impact_score ?? 0,
    summaryPl: r.summary_pl,
    classifiedBy: r.classified_by === "ai" ? "ai" : "heuristic",
  }));
  const sentimentBySymbol = new Map(aggregateSentiment(news).map((r) => [r.symbol, r]));

  // Import dynamiczny, jak przy quotes.server/news.server: trzyma klucze
  // i wywołania modelu poza bundlem klienta.
  const { forecastWithModel } = await import("./forecast.server");

  const prepared = assets.flatMap((asset) => {
    const points = normalizeSeries(pointsBySymbol.get(asset.symbol) ?? []);
    if (points.length < 2) return [];
    const technical = scoreSignals(computeSignals(points));
    const sentiment = sentimentBySymbol.get(asset.symbol) ?? null;
    const headlines = news
      .filter((n) => n.symbols.includes(asset.symbol))
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 4)
      .map((n) => n.title);
    return [
      {
        asset,
        technical,
        sentimentScore: sentiment?.score ?? null,
        sentimentItems: sentiment?.items ?? 0,
        headlines,
        lastPrice: points[points.length - 1].close,
      },
    ];
  });

  const forecast = await forecastWithModel(prepared, keys);

  const rows: OutlookRow[] = prepared.map((input, idx) => {
    const combined = combineOutlook(input.technical, input.sentimentScore, input.sentimentItems);
    const verdict = forecast.verdicts[idx];
    return {
      symbol: input.asset.symbol,
      label: input.asset.label,
      assetClass: input.asset.assetClass,
      currency: input.asset.currency,
      colorToken: input.asset.colorToken,
      lastPrice: input.lastPrice,
      score: combined.score,
      direction: combined.direction,
      confidence: combined.confidence,
      technicalScore: input.technical.score,
      sentimentScore: input.sentimentScore,
      sentimentItems: input.sentimentItems,
      drivers: input.technical.drivers,
      // Werdykt „ai" istnieje tylko wtedy, gdy model faktycznie
      // odpowiedział — inaczej podpisalibyśmy arytmetykę nazwą modelu.
      ai: forecast.model
        ? {
            direction: verdict.direction,
            confidence: verdict.confidence,
            rationalePl: verdict.rationalePl,
          }
        : null,
    };
  });

  await recordPredictions(supabase, userId, rows, forecast.model);

  await recordPredictions(supabase, userId, rows, forecast.model);

  // Pusty typer wygląda w UI tak samo, niezależnie od przyczyny: braku
  // notowań w cache'u, zbyt krótkich serii czy pustej watchlisty. Bez tego
  // wpisu diagnoza sprowadzała się do zgadywania — stąd liczby, które
  // rozstrzygają, gdzie urwał się łańcuch.
  if (rows.length === 0) {
    await logEvent(
      supabase,
      userId,
      "warn",
      `Typer nie policzył żadnego sygnału: ${assets.length} instrumentów na watchliście, ` +
        `${quoteRows.length} wierszy notowań w cache, ${pointsBySymbol.size} instrumentów z jakimkolwiek notowaniem`,
      { symbols } as Json,
    );
  }

  return {
    // Najmocniejsze sygnały na górze, niezależnie od kierunku.
    rows: rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
    model: forecast.model,
  };
}

/**
 * Zapisuje prognozy razem z ceną z momentu ich postawienia.
 *
 * Bez tej ceny rozliczenie byłoby zgadywaniem, od czego liczyć zmianę, a
 * trafności nie da się odtworzyć wstecz — albo zapisujemy ją od pierwszego
 * dnia, albo nie dowiemy się nigdy, czy moduł działa.
 *
 * Ograniczenie UNIQUE w migracji dopuszcza jedną prognozę dziennie na
 * instrument i źródło, więc `ignoreDuplicates` sprawia, że kolejne
 * odświeżenia tego samego dnia nie rozcieńczają statystyki.
 */
async function recordPredictions(
  supabase: Db,
  userId: string,
  rows: OutlookRow[],
  model: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  const dueAt = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString();

  const base = rows.map((row) => ({
    owner_id: userId,
    symbol: row.symbol,
    horizon_days: HORIZON_DAYS,
    due_at: dueAt,
    price_at_prediction: row.lastPrice,
    technical_score: row.technicalScore,
    sentiment_score: row.sentimentScore,
  }));

  const signalRows = base.map((b, i) => ({
    ...b,
    direction: rows[i].direction,
    confidence: rows[i].confidence,
    rationale_pl: rows[i].drivers[0]?.note ?? null,
    source: "signals" as const,
    model: null,
  }));

  // Prognoza modelu zapisywana OSOBNO, żeby panel skuteczności mógł
  // odpowiedzieć, czy model bije prostą arytmetykę.
  const aiRows = model
    ? base.flatMap((b, i) => {
        const ai = rows[i].ai;
        if (!ai) return [];
        return [
          {
            ...b,
            direction: ai.direction,
            confidence: ai.confidence,
            rationale_pl: ai.rationalePl,
            source: "ai" as const,
            model,
          },
        ];
      })
    : [];

  const { error } = await supabase.from("market_predictions").upsert([...signalRows, ...aiRows], {
    onConflict: "owner_id,symbol,source,horizon_days,made_on",
    ignoreDuplicates: true,
  });
  if (error) {
    await logEvent(supabase, userId, "warn", `Zapis prognoz: ${error.message}`, {} as Json);
  }
}

// ------------------------------------------------------- rozliczanie ----

/**
 * Rozlicza prognozy, którym minął termin.
 *
 * Cena rozliczeniowa to pierwsze notowanie NIE WCZEŚNIEJSZE niż termin —
 * a nie po prostu „ostatnie, jakie mamy". Ta różnica jest istotna: gdyby
 * brać ostatnie notowanie, prognoza sprzed dwóch miesięcy rozliczyłaby się
 * wobec dzisiejszej ceny, czyli na zupełnie innym horyzoncie niż ten, który
 * zadeklarowała.
 */
export async function resolveDuePredictions(supabase: Db, userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("market_predictions")
    .select("id, symbol, direction, due_at, price_at_prediction")
    .eq("owner_id", userId)
    .is("outcome", null)
    .lte("due_at", nowIso)
    .limit(200);
  if (error || !due || due.length === 0) return 0;

  let resolved = 0;
  for (const prediction of due) {
    const dueDate = prediction.due_at.slice(0, 10);
    const { data: quote } = await supabase
      .from("market_quotes")
      .select("close, quote_date")
      .eq("symbol", prediction.symbol)
      .gte("quote_date", dueDate)
      .order("quote_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Brak notowania z terminu albo po nim znaczy, że jeszcze nie ma czym
    // rozliczyć (weekend, święto, luka w danych) — zostawiamy na później.
    if (!quote) continue;

    const change = percentChange(Number(prediction.price_at_prediction), Number(quote.close));
    if (change === null) continue;

    const { error: updErr } = await supabase
      .from("market_predictions")
      .update({
        resolved_at: new Date().toISOString(),
        price_at_resolution: Number(quote.close),
        actual_change_pct: change,
        outcome: resolveOutcome(prediction.direction as PredictionDirection, change),
      })
      .eq("id", prediction.id)
      .eq("owner_id", userId);
    if (!updErr) resolved += 1;
  }
  return resolved;
}
