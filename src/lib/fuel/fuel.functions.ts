// ORLEN FUEL GRID — server functions modułu monitoringu hurtowych cen paliw.
//
// Pobieranie idzie przez serwer, bo tool.orlen.pl nie wystawia nagłówka
// Access-Control-Allow-Origin — przeglądarka dostałaby ścianę CORS. Ten sam
// powód i ten sam wzorzec co src/lib/geo/flightRadar.functions.ts, łącznie
// z logowaniem awarii do system_events, żeby były widoczne w /system-logs
// bez zaglądania do devtools.
//
// Zapisuje `resolveWriter` (niżej): service_role, gdy aplikacja go ma, a poza
// tym sesja zalogowanego użytkownika.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { DEFAULT_PRODUCT_ID, ORLEN_PRODUCTS, productById, type OrlenProduct } from "./orlen";
import {
  bestLagCorrelation,
  computeStats,
  forecastNext,
  type FuelStats,
  type Forecast,
  type PricePoint,
} from "./analytics";
import type { Impact } from "./news";
// Tylko typ — import jest wymazywany, więc ten plik nie wciąga
// ingest.server.ts do bundla klienta.
import type { Db } from "./ingest.server";
import { fetchAllPages } from "./paginate";

// ------------------------------------------------------------- typy ----

export type FuelSeries = {
  productId: number;
  code: string;
  label: string;
  colorToken: string;
  points: PricePoint[];
  stats: FuelStats;
};

export type FuelGrid = {
  series: FuelSeries[];
  /** Data ostatniej publikacji Orlenu w cache (nie licząc dni domkniętych). */
  lastPublished: string | null;
  refreshedAt: string;
  /** true, gdy to wywołanie faktycznie odpytało Orlen (a nie tylko cache). */
  didFetch: boolean;
  /**
   * Czym moduł zapisał cache przy tym żądaniu: kluczem service_role
   * (gdy aplikacja go ma) czy sesją zalogowanego użytkownika. Wpływa tylko
   * na to, co pokazuje panel diagnostyczny — dane są w obu trybach te same.
   */
  writeMode: "service_role" | "session";
};

export type MarketOverlay = {
  points: Array<{ date: string; brentUsd: number; usdPln: number; brentPlnPerM3: number }>;
  latestBrentUsd: number | null;
  latestUsdPln: number | null;
  latestBrentPlnPerM3: number | null;
  /** Cena hurtowa minus koszt surowca — marża rafineryjno-hurtowa + koszty. */
  spreadPlnPerM3: number | null;
  correlation: { lagDays: number; r: number };
  /** Jaki % ostatniego 30-dniowego ruchu ropy (w PLN) jest już w cenniku. */
  passThroughPct: number | null;
};

export type FuelNewsItem = {
  id: string;
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  feedTag: string | null;
  impact: Impact | null;
  impactScore: number | null;
  summaryPl: string | null;
  classifiedBy: string | null;
};

export type FuelAlert = {
  id: string;
  productId: number;
  kind: "daily_change_abs" | "level_above" | "level_below";
  threshold: number;
  isEnabled: boolean;
  lastTriggeredAt: string | null;
};

// -------------------------------------------------- strażnik świeżości ----

// Orlen publikuje cennik raz dziennie, więc odpytywanie go częściej niż co
// kwadrans to czysty koszt. Moduł żyje w procesie Nitro tak długo jak on,
// a `inFlight` gwarantuje, że pięciu jednoczesnych czytelników wywoła jeden
// zaciąg, nie pięć (ten sam wzorzec co GithubActivityPulse po stronie UI).
const MIN_PRICE_REFRESH_MS = 15 * 60_000;
const MIN_MARKET_REFRESH_MS = 60 * 60_000;
const MIN_NEWS_REFRESH_MS = 10 * 60_000;

let lastPriceIngest = 0;
let lastMarketIngest = 0;
let lastNewsIngest = 0;
let priceInFlight: Promise<unknown> | null = null;
let marketInFlight: Promise<unknown> | null = null;
let newsInFlight: Promise<unknown> | null = null;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

type LogContext = { supabase: SupabaseClient<Database>; userId: string };

/**
 * Awaria źródła nie może wywrócić strony — moduł ma pokazać cache i lecieć
 * dalej. Ale musi zostawić ślad w system_events, inaczej „dane sprzed
 * dwóch dni" wyglądają identycznie jak „dane aktualne".
 */
async function logEvent(
  context: LogContext,
  level: "error" | "warn",
  message: string,
  meta: Json,
): Promise<void> {
  try {
    await context.supabase.from("system_events").insert({
      owner_id: context.userId,
      level,
      source: "orlen-fuel",
      message,
      meta,
    });
  } catch {
    // Logowanie nie ma prawa wysypać żądania.
  }
}

const logFailure = (context: LogContext, message: string, meta: Json) =>
  logEvent(context, "error", message, meta);

// ------------------------------------------------------- kto zapisuje ----

/**
 * Klient, którym moduł zapisuje do cache'u.
 *
 * Pierwszy wybór to service_role — omija RLS i nie zależy od tego, kto
 * akurat jest zalogowany. Ale w tej instalacji Supabase jest zarządzany
 * przez Lovable i ten klucz jest poza zasięgiem właściciela, więc drugim
 * wyborem jest klient bieżącego użytkownika: migracja
 * 20260920140000_fuel_grid_authenticated_writes.sql daje zalogowanym prawo
 * zapisu do trzech tabel cache. Ten sam wybór co w local-worker/worker.py,
 * który celowo loguje się kluczem anon zamiast service role.
 *
 * Zwraca też `viaServiceRole`, bo to rozróżnienie decyduje, czy operacja
 * ciężka (pełna archiwizacja) ma sens z poziomu przeglądarki.
 */
async function resolveWriter(context: LogContext): Promise<{ db: Db; viaServiceRole: boolean }> {
  const { resolveWriteClient } = await import("./writeAccess.server");
  const admin = (await resolveWriteClient()) as Db | null;
  if (admin) return { db: admin, viaServiceRole: true };

  await noteSessionWrites(context);
  return { db: context.supabase as Db, viaServiceRole: false };
}

// Informacja o trybie zapisu ma sens raz na proces — inaczej zalałaby
// System Logs przy każdym odświeżeniu co pięć minut.
let sessionWritesNoted = false;

async function noteSessionWrites(context: LogContext): Promise<void> {
  if (sessionWritesNoted) return;
  sessionWritesNoted = true;
  await logEvent(
    context,
    "warn",
    "Brak SUPABASE_SERVICE_ROLE_KEY — moduł paliwowy zapisuje cache sesją zalogowanego " +
      "użytkownika (polityki z migracji 20260920140000).",
    {} as Json,
  );
}

// ------------------------------------------------------ ceny + wykres ----

const GridInput = z
  .object({
    days: z.number().int().min(7).max(8000).optional().default(365),
  })
  .optional();

export const getFuelGrid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GridInput.parse(input))
  .handler(async ({ data, context }): Promise<FuelGrid> => {
    const days = data?.days ?? 365;
    const { supabase, userId } = context;

    const writer = await resolveWriter({ supabase, userId });

    let didFetch = false;
    if (Date.now() - lastPriceIngest > MIN_PRICE_REFRESH_MS) {
      const { ingestPrices } = await import("./ingest.server");
      priceInFlight ??= ingestPrices(writer.db).finally(() => {
        priceInFlight = null;
        lastPriceIngest = Date.now();
      });
      const summaries = (await priceInFlight) as Array<{ product: string; error?: string }>;
      didFetch = true;

      const failed = summaries.filter((s) => s.error);
      if (failed.length > 0) {
        await logFailure(
          { supabase, userId },
          `Orlen ingest failed for: ${failed.map((f) => `${f.product} (${f.error})`).join(", ")}`,
          { summaries } as unknown as Json,
        );
      }
    }

    // Stronicowane, bo rok historii pięciu paliw to 1825 wierszy, a pięć lat
    // ponad 9000 — powyżej limitu, który Supabase ucina bez błędu.
    // `product_id` jako drugi klucz sortowania: datę dzieli pięć produktów,
    // a przy podziale na strony niejednoznaczna kolejność gubi wiersze.
    let rows: Array<{
      product_id: number;
      price_date: string;
      price_per_m3: number;
      is_gap_fill: boolean;
    }>;
    try {
      rows = await fetchAllPages((from, to) =>
        supabase
          .from("orlen_fuel_prices")
          .select("product_id, price_date, price_per_m3, is_gap_fill")
          .gte("price_date", isoDaysAgo(days))
          .order("price_date", { ascending: true })
          .order("product_id", { ascending: true })
          .range(from, to),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logFailure({ supabase, userId }, `Fuel cache read failed: ${message}`, {
        days,
      } as unknown as Json);
      throw err;
    }

    const byProduct = new Map<number, PricePoint[]>();
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push({
        date: row.price_date,
        price: Number(row.price_per_m3),
        isGapFill: row.is_gap_fill,
      });
      byProduct.set(row.product_id, list);
    }

    const series: FuelSeries[] = ORLEN_PRODUCTS.map((product: OrlenProduct) => {
      const points = byProduct.get(product.id) ?? [];
      return {
        productId: product.id,
        code: product.code,
        label: product.label,
        colorToken: product.colorToken,
        points,
        stats: computeStats(points),
      };
    });

    let lastPublished: string | null = null;
    for (const s of series) {
      for (let i = s.points.length - 1; i >= 0; i -= 1) {
        if (!s.points[i].isGapFill) {
          if (!lastPublished || s.points[i].date > lastPublished) lastPublished = s.points[i].date;
          break;
        }
      }
    }

    return {
      series,
      lastPublished,
      refreshedAt: new Date().toISOString(),
      didFetch,
      writeMode: writer.viaServiceRole ? "service_role" : "session",
    };
  });

/**
 * Pełna archiwizacja od 2004 — ~26 tys. wierszy, kilkanaście sekund.
 * Osobna funkcja i osobny przycisk, bo to operacja, której nie chce się
 * odpalać przypadkiem przy każdym wejściu na stronę.
 */
export const backfillFuelHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ written: number; errors: string[] }> => {
    const writer = await resolveWriter(context);
    const { ingestPrices } = await import("./ingest.server");

    const summaries = await ingestPrices(writer.db, { full: true });
    lastPriceIngest = Date.now();

    const errors = summaries.filter((s) => s.error).map((s) => `${s.product}: ${s.error}`);
    if (errors.length > 0) {
      await logFailure(context, `Backfill errors: ${errors.join("; ")}`, {
        summaries,
      } as unknown as Json);
    }
    return { written: summaries.reduce((sum, s) => sum + s.written, 0), errors };
  });

// -------------------------------------------------------- rynek/Brent ----

const OverlayInput = z
  .object({
    days: z.number().int().min(30).max(2000).optional().default(365),
    productId: z.number().int().optional().default(DEFAULT_PRODUCT_ID),
  })
  .optional();

export const getMarketOverlay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OverlayInput.parse(input))
  .handler(async ({ data, context }): Promise<MarketOverlay> => {
    const days = data?.days ?? 365;
    const productId = data?.productId ?? DEFAULT_PRODUCT_ID;
    const { supabase, userId } = context;

    if (Date.now() - lastMarketIngest > MIN_MARKET_REFRESH_MS) {
      const writer = await resolveWriter({ supabase, userId });
      const { ingestMarket } = await import("./ingest.server");
      marketInFlight ??= ingestMarket(writer.db, { days }).finally(() => {
        marketInFlight = null;
        lastMarketIngest = Date.now();
      });
      const summary = (await marketInFlight) as { error?: string };
      if (summary.error) {
        await logFailure({ supabase, userId }, `Market ingest failed: ${summary.error}`, {
          days,
        } as unknown as Json);
      }
    }

    const fromDate = isoDaysAgo(days);
    // Odczyt idzie klientem użytkownika (RLS pozwala czytać każdemu
    // zalogowanemu) — service_role jest potrzebny wyłącznie do zapisu.
    const { readMarketSeries } = await import("./ingest.server");
    const { brent, usdPln } = await readMarketSeries(supabase, fromDate);

    const { joinSeries } = await import("./market");
    const points = joinSeries(brent, usdPln);

    // Jeden produkt, ale zakres sięga 2000 dni — też ponad limit strony.
    // `price_date` jest tu unikalne (filtr po product_id), więc wystarcza
    // jako jedyny klucz sortowania.
    const priceRows = await fetchAllPages((from, to) =>
      supabase
        .from("orlen_fuel_prices")
        .select("price_date, price_per_m3")
        .eq("product_id", productId)
        .gte("price_date", fromDate)
        .order("price_date", { ascending: true })
        .range(from, to),
    );

    const priceByDate = new Map(priceRows.map((r) => [r.price_date, Number(r.price_per_m3)]));

    // Korelacja liczona tylko na dniach, w których mamy OBIE wartości —
    // inaczej weekend (jest cennik, nie ma sesji) przesuwałby serie
    // względem siebie i psuł wynik.
    const alignedFuel: number[] = [];
    const alignedBrent: number[] = [];
    for (const point of points) {
      const price = priceByDate.get(point.date);
      if (price === undefined) continue;
      alignedFuel.push(price);
      alignedBrent.push(point.brentPlnPerM3);
    }

    const correlation = bestLagCorrelation(alignedFuel, alignedBrent);

    const last = points[points.length - 1] ?? null;
    const latestFuel = alignedFuel[alignedFuel.length - 1] ?? null;

    let passThroughPct: number | null = null;
    if (alignedFuel.length > 31) {
      const brentMove =
        alignedBrent[alignedBrent.length - 1] - alignedBrent[alignedBrent.length - 31];
      const fuelMove = alignedFuel[alignedFuel.length - 1] - alignedFuel[alignedFuel.length - 31];
      if (Math.abs(brentMove) > 1) {
        passThroughPct = Math.round((fuelMove / brentMove) * 100);
      }
    }

    return {
      points,
      latestBrentUsd: last?.brentUsd ?? null,
      latestUsdPln: last?.usdPln ?? null,
      latestBrentPlnPerM3: last?.brentPlnPerM3 ?? null,
      spreadPlnPerM3:
        latestFuel !== null && last
          ? Math.round((latestFuel - last.brentPlnPerM3) * 100) / 100
          : null,
      correlation,
      passThroughPct,
    };
  });

// ---------------------------------------------------------- prognoza ----

const ForecastInput = z
  .object({
    productId: z.number().int().optional().default(DEFAULT_PRODUCT_ID),
    horizonDays: z.number().int().min(1).max(14).optional().default(5),
  })
  .optional();

export const getFuelForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ForecastInput.parse(input))
  .handler(async ({ data, context }): Promise<Forecast & { productId: number }> => {
    const productId = data?.productId ?? DEFAULT_PRODUCT_ID;
    const horizonDays = data?.horizonDays ?? 5;

    const { data: rows } = await context.supabase
      .from("orlen_fuel_prices")
      .select("price_date, price_per_m3")
      .eq("product_id", productId)
      .gte("price_date", isoDaysAgo(90))
      .order("price_date", { ascending: true });

    const points: PricePoint[] = (rows ?? []).map((r) => ({
      date: r.price_date,
      price: Number(r.price_per_m3),
    }));

    return { ...forecastNext(points, horizonDays), productId };
  });

// ------------------------------------------------------------- newsy ----

const NewsInput = z
  .object({ limit: z.number().int().min(5).max(100).optional().default(40) })
  .optional();

export const getFuelNews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NewsInput.parse(input))
  .handler(async ({ data, context }): Promise<FuelNewsItem[]> => {
    const limit = data?.limit ?? 40;
    const { supabase, userId } = context;

    if (Date.now() - lastNewsIngest > MIN_NEWS_REFRESH_MS) {
      const writer = await resolveWriter({ supabase, userId });
      // Klucz Gemini jest BYOK (user_secrets) — bez niego newsy dalej
      // działają, tylko z oceną heurystyczną zamiast streszczeń po polsku.
      const { data: secret } = await supabase
        .from("user_secrets")
        .select("gemini_api_key")
        .eq("owner_id", userId)
        .maybeSingle();

      const { ingestNews } = await import("./ingest.server");
      newsInFlight ??= ingestNews(writer.db, secret?.gemini_api_key?.trim() || null).finally(() => {
        newsInFlight = null;
        lastNewsIngest = Date.now();
      });
      const summary = (await newsInFlight) as { error?: string };
      if (summary.error) {
        await logFailure({ supabase, userId }, `News ingest failed: ${summary.error}`, {} as Json);
      }
    }

    const { data: rows } = await supabase
      .from("fuel_news_items")
      .select(
        "id, title, link, source, published_at, feed_tag, impact, impact_score, summary_pl, classified_by",
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    return (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      link: r.link,
      source: r.source,
      publishedAt: r.published_at,
      feedTag: r.feed_tag,
      impact: (r.impact as Impact | null) ?? null,
      impactScore: r.impact_score,
      summaryPl: r.summary_pl,
      classifiedBy: r.classified_by,
    }));
  });

// ------------------------------------------------------------ alerty ----

export const getFuelAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FuelAlert[]> => {
    const { data } = await context.supabase
      .from("fuel_price_alerts")
      .select("id, product_id, kind, threshold, is_enabled, last_triggered_at")
      .eq("owner_id", context.userId)
      .order("product_id", { ascending: true });

    return (data ?? []).map((r) => ({
      id: r.id,
      productId: r.product_id,
      kind: r.kind as FuelAlert["kind"],
      threshold: Number(r.threshold),
      isEnabled: r.is_enabled,
      lastTriggeredAt: r.last_triggered_at,
    }));
  });

const SaveAlertInput = z.object({
  productId: z
    .number()
    .int()
    .refine((id) => productById(id) !== undefined, "unknown product"),
  kind: z.enum(["daily_change_abs", "level_above", "level_below"]),
  threshold: z.number().positive().max(99_999),
  isEnabled: z.boolean().optional().default(true),
});

export const saveFuelAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveAlertInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("fuel_price_alerts")
      .upsert(
        {
          owner_id: context.userId,
          product_id: data.productId,
          kind: data.kind,
          threshold: data.threshold,
          is_enabled: data.isEnabled,
        },
        { onConflict: "owner_id,product_id,kind" },
      )
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const DeleteAlertInput = z.object({ id: z.string().uuid() });

export const deleteFuelAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteAlertInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("fuel_price_alerts")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
