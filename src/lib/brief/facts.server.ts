// PORANNY BRIEFING — zbieranie faktów. Wyłącznie odczyty, ani jednego zapisu.
//
// TO JEST TU NAJWAŻNIEJSZE: briefing niczego nie PRZELICZA. Nie woła
// `buildOutlook`, choć kusi — tamta funkcja przy okazji ZAPISUJE prognozę na
// dziś, a briefing biegnie rano, przed wieczornym zaciągiem notowań.
// Postawiłby więc prognozę na wczorajszych cenach, którą wieczorny job
// nadpisałby swoją: ta sama tabela dostałaby dwa różne „dziś" i statystyka
// trafności liczyłaby się z czegoś, czego typer nigdy nie powiedział.
// Briefing czyta to, co już postanowiono, i tyle.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { assetBySymbol } from "@/lib/markets/assets";
import { productById, DEFAULT_PRODUCT_ID } from "@/lib/fuel/orlen";
import { labelsFor } from "@/lib/orders/subjects";
import { describeOrder, type StandingOrder } from "@/lib/orders/rules";
import { warsawDate } from "@/lib/format/warsaw";
import { currentBudget } from "@/lib/agents/budget.server";
import { fetchDayWeather } from "@/lib/weather/openMeteo.server";
import { logServerError } from "@/lib/system/logServerError";
import { budgetMessage } from "@/lib/agents/budget";
import type { BriefFacts } from "./types";

type Db = SupabaseClient<Database>;

/** Ile dni historii notowań wystarczy do zmiany dobowej z zapasem na weekend. */
const QUOTE_WINDOW_DAYS = 10;

/** Ile dni wstecz liczymy zmianę ceny paliwa. */
const FUEL_WINDOW_DAYS = 10;

/** Okno „od wczoraj" dla rozkazów i awarii. */
const DAY_MS = 86_400_000;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Największe ruchy na watchliście przez ostatnią sesję.
 *
 * Zmianę liczymy między dwoma OSTATNIMI notowaniami instrumentu, a nie
 * „dziś kontra wczoraj": w poniedziałek rano ostatnia sesja akcji jest z
 * piątku i to ona jest wiadomością, nie brak notowania z niedzieli.
 */
async function loadMovers(db: Db, ownerId: string): Promise<BriefFacts["movers"]> {
  const { data: watch } = await db
    .from("market_watchlist")
    .select("symbol")
    .eq("owner_id", ownerId);
  const symbols = (watch ?? []).map((r) => r.symbol);
  if (symbols.length === 0) return [];

  const since = isoDate(new Date(Date.now() - QUOTE_WINDOW_DAYS * DAY_MS));
  const { data: quotes } = await db
    .from("market_quotes")
    .select("symbol, quote_date, close")
    .in("symbol", symbols)
    .gte("quote_date", since)
    .order("quote_date", { ascending: true });

  const bySymbol = new Map<string, number[]>();
  for (const row of quotes ?? []) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(Number(row.close));
    bySymbol.set(row.symbol, list);
  }

  const movers: BriefFacts["movers"] = [];
  for (const [symbol, closes] of bySymbol) {
    if (closes.length < 2) continue;
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    if (!(prev > 0)) continue;
    const asset = assetBySymbol(symbol);
    movers.push({
      symbol,
      label: asset?.label ?? symbol,
      changePct: ((last - prev) / prev) * 100,
      lastPrice: last,
      currency: asset?.currency ?? "",
    });
  }

  // Sortowanie po SILE ruchu, nie po kierunku: spadek o 8% jest równie
  // istotny jak wzrost o 8%, a briefing ma pokazać to, co się wydarzyło.
  return movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** Najnowsza nierozliczona prognoza na instrument. */
async function loadCalls(db: Db, ownerId: string): Promise<BriefFacts["calls"]> {
  const { data } = await db
    .from("market_predictions")
    .select("symbol, direction, confidence, made_at")
    .eq("owner_id", ownerId)
    .is("resolved_at", null)
    .order("made_at", { ascending: false })
    .limit(60);

  const seen = new Set<string>();
  const calls: BriefFacts["calls"] = [];
  for (const row of data ?? []) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    calls.push({
      symbol: row.symbol,
      label: assetBySymbol(row.symbol)?.label ?? row.symbol,
      direction: row.direction as "up" | "down" | "flat",
      confidence: row.confidence,
    });
  }
  return calls.sort((a, b) => b.confidence - a.confidence);
}

async function loadAccuracy(db: Db, ownerId: string): Promise<BriefFacts["accuracy"]> {
  const { data } = await db
    .from("market_predictions")
    .select("outcome")
    .eq("owner_id", ownerId)
    .not("outcome", "is", null);

  const settled = data?.length ?? 0;
  if (settled === 0) return { settled: 0, hitRatePct: null };
  const hits = (data ?? []).filter((r) => r.outcome === "hit").length;
  return { settled, hitRatePct: Math.round((hits / settled) * 100) };
}

/** Paliwo referencyjne: to samo, które moduł pokazuje domyślnie. */
async function loadFuel(db: Db): Promise<BriefFacts["fuel"]> {
  const product = productById(DEFAULT_PRODUCT_ID);
  if (!product) return null;

  const since = isoDate(new Date(Date.now() - (FUEL_WINDOW_DAYS + 7) * DAY_MS));
  const { data } = await db
    .from("orlen_fuel_prices")
    .select("price_date, price_per_m3")
    .eq("product_id", product.id)
    .eq("is_gap_fill", false)
    .gte("price_date", since)
    .order("price_date", { ascending: true });

  const points = (data ?? []).map((r) => ({
    date: r.price_date,
    price: Number(r.price_per_m3),
  }));
  if (points.length === 0) return null;

  const last = points[points.length - 1];
  const weekAgoDate = isoDate(new Date(Date.parse(`${last.date}T00:00:00Z`) - 7 * DAY_MS));
  // Ostatni punkt NIE MŁODSZY niż tydzień wstecz — cennik nie wychodzi w
  // weekendy, więc „dokładnie siedem dni temu" często nie istnieje.
  const reference = [...points].reverse().find((p) => p.date <= weekAgoDate);

  return {
    label: product.label,
    price: last.price,
    unit: "PLN/m³",
    changeWeekPct:
      reference && reference.price > 0
        ? ((last.price - reference.price) / reference.price) * 100
        : null,
  };
}

/** Rozkazy, które wyzwoliły się od wczoraj — pomost do kroku pierwszego. */
async function loadFiredOrders(db: Db, ownerId: string): Promise<BriefFacts["firedOrders"]> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data } = await db
    .from("standing_orders")
    .select(
      "id, subject_kind, subject, condition, threshold, window_days, cooldown_hours, phrase, is_enabled, expires_at, last_triggered_at, trigger_count",
    )
    .eq("owner_id", ownerId)
    .not("last_triggered_at", "is", null)
    .gte("last_triggered_at", since)
    .order("last_triggered_at", { ascending: false });

  return (data ?? []).map((row) => {
    const order: StandingOrder = {
      id: row.id,
      subjectKind: row.subject_kind as StandingOrder["subjectKind"],
      subject: row.subject,
      condition: row.condition as StandingOrder["condition"],
      threshold: Number(row.threshold),
      windowDays: row.window_days,
      cooldownHours: row.cooldown_hours,
      phrase: row.phrase,
      isEnabled: row.is_enabled,
      expiresAt: row.expires_at,
      lastTriggeredAt: row.last_triggered_at,
      triggerCount: row.trigger_count,
    };
    // Ten sam opis, który widać w panelu rozkazów — użytkownik ma poznać
    // swój rozkaz po brzmieniu, a nie odszyfrowywać go drugi raz.
    return {
      description: describeOrder(order, labelsFor(order.subjectKind, order.subject)),
      firedAt: row.last_triggered_at!,
    };
  });
}

async function loadTasks(db: Db, ownerId: string): Promise<BriefFacts["tasks"]> {
  const todayEnd = `${isoDate(new Date())}T23:59:59.999Z`;
  const { data } = await db
    .from("tasks")
    .select("title, due_at")
    .eq("user_id", ownerId)
    .in("status", ["todo", "in_progress"])
    .not("due_at", "is", null)
    .lte("due_at", todayEnd)
    .order("due_at", { ascending: true })
    .limit(30);

  const nowIso = new Date().toISOString();
  const overdue: BriefFacts["tasks"]["overdue"] = [];
  const today: BriefFacts["tasks"]["today"] = [];
  for (const row of data ?? []) {
    if (row.due_at && row.due_at < nowIso) overdue.push({ title: row.title, dueAt: row.due_at });
    else today.push({ title: row.title });
  }
  return { overdue, today };
}

/** Stan budżetu — tylko wtedy, gdy jest o czym mówić. */
async function loadBudget(db: Db, ownerId: string): Promise<BriefFacts["budget"]> {
  const status = await currentBudget(db, ownerId);
  const message = budgetMessage(status);
  // Budżet w normie nie jest wiadomością. Codzienne „zużyto 12% limitu"
  // nauczyłoby przewijać całą rubrykę.
  if (!message) return null;
  return { spentUsd: status.spentUsd, limitUsd: status.limitUsd, message };
}

/**
 * Pogoda na dziś — tylko wtedy, gdy jest dla KTÓREGO miejsca.
 *
 * Nocny job nie ma przeglądarki, więc nie ma kogo zapytać o lokalizację.
 * Brak zapisanego punktu nie jest awarią: rubryka po prostu nie zaczyna się
 * od pogody. Zgadywanie miasta na sztywno byłoby gorsze niż milczenie —
 * „dziś słonecznie" o mieście, w którym akurat nie ma użytkownika, uczy nie
 * ufać całej reszcie briefingu.
 *
 * ALE BRAK PUNKTU I ZEPSUTE POBRANIE TO DWIE RÓŻNE RZECZY. Pierwsze jest
 * wyborem użytkownika i ma prawo być ciche. Drugie jest awarią i musi
 * zostawić ślad — inaczej rubryka bez pogody nie mówi NIC o tym, czego jej
 * brakuje, i jedynym sposobem sprawdzenia zostaje zgadywanie. Ślad idzie do
 * `system_events`, czyli tam, skąd następny briefing czyta sekcję „Usterki".
 */
async function loadWeather(db: Db, ownerId: string): Promise<BriefFacts["weather"]> {
  const { data, error } = await db
    .from("user_settings")
    .select("home_lat, home_lon")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    await logServerError(db, ownerId, "brief.weather", error);
    return null;
  }

  const lat = data?.home_lat;
  const lon = data?.home_lon;
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;

  try {
    return await fetchDayWeather(Number(lat), Number(lon));
  } catch (err) {
    // Współrzędne w meta, bo połowa możliwych przyczyn to właśnie one:
    // zamienione miejscami, ucięte do zera, zapisane jako tekst.
    await logServerError(db, ownerId, "brief.weather", err, {
      lat: Number(lat),
      lon: Number(lon),
    } as Json);
    return null;
  }
}

async function loadFailures(db: Db, ownerId: string): Promise<BriefFacts["failures"]> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data } = await db
    .from("system_events")
    .select("message, created_at")
    .eq("owner_id", ownerId)
    .eq("level", "error")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = data ?? [];
  return {
    count: rows.length,
    sample: rows[0]?.message?.slice(0, 200) ?? null,
  };
}

/**
 * Zbiera komplet faktów na dziś.
 *
 * Zapytania idą RÓWNOLEGLE — jest ich dziewięć, a job i tak czeka na
 * najwolniejsze. Awaria jednego źródła nie może wywrócić briefingu:
 * lepiej rubryka bez sekcji paliwowej niż brak rubryki.
 */
export async function gatherFacts(db: Db, ownerId: string): Promise<BriefFacts> {
  const safe = async <T>(load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch {
      return fallback;
    }
  };

  const [movers, calls, accuracy, fuel, firedOrders, tasks, failures, budget, weather] =
    await Promise.all([
      safe(() => loadMovers(db, ownerId), []),
      safe(() => loadCalls(db, ownerId), []),
      safe(() => loadAccuracy(db, ownerId), { settled: 0, hitRatePct: null }),
      safe(() => loadFuel(db), null),
      safe(() => loadFiredOrders(db, ownerId), []),
      safe(() => loadTasks(db, ownerId), { overdue: [], today: [] }),
      safe(() => loadFailures(db, ownerId), { count: 0, sample: null }),
      safe(() => loadBudget(db, ownerId), null),
      safe(() => loadWeather(db, ownerId), null),
    ]);

  return {
    // Data WARSZAWSKA, nie UTC. O 00:30 czasu lokalnego w UTC trwa jeszcze
    // poprzedni dzień — rubryka wylądowałaby wtedy pod wczorajszą datą, a
    // harmonogram (który liczy dobę lokalnie) uznałby, że dzisiejszej nadal
    // nie ma i złożyłby drugą.
    date: warsawDate(new Date()),
    movers,
    calls,
    accuracy,
    fuel,
    firedOrders,
    tasks,
    failures,
    budget,
    weather,
  };
}
