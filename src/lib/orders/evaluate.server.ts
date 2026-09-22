// STAŁE ROZKAZY — warstwa z bazą. Wyciąga rozkazy i serie, oddaje decyzję
// czystemu ewaluatorowi z rules.ts, a trafienia zamienia w meldunki.
//
// PODZIAŁ PRACY jest tu celowy i pilnowany: cała arytmetyka („czy 6% to już
// spadek o 5%", „czy rozkaz jest jeszcze wyciszony") siedzi w rules.ts i jest
// pokryta testami bez bazy. Tutaj zostaje wyłącznie I/O — dzięki temu
// zmiana progu czy okna nie wymaga dotykania kodu rozmawiającego z Supabase,
// a błąd w regule nie chowa się za mockiem klienta.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { notifyOwner } from "@/lib/notifications/notify.server";
import { fuelProductByCode, labelsFor } from "./subjects";
import { evaluateOrder, formatHit, type SeriesPoint, type StandingOrder } from "./rules";
import type { SubjectKind } from "./rules";

type Db = SupabaseClient<Database>;

/** Ile dni historii wystarczy każdemu warunkowi — okno nie przekracza 90 dni. */
const HISTORY_DAYS = 120;

export type OrderRunSummary = {
  checked: number;
  triggered: number;
  /** Rozkazy, których nie dało się sprawdzić (nieznany przedmiot, brak serii). */
  skipped: number;
  errors: string[];
};

type OrderRow = {
  id: string;
  owner_id: string;
  subject_kind: string;
  subject: string;
  condition: string;
  threshold: string | number;
  window_days: number;
  cooldown_hours: number;
  phrase: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
};

const toOrder = (row: OrderRow): StandingOrder => ({
  id: row.id,
  subjectKind: row.subject_kind as SubjectKind,
  subject: row.subject,
  condition: row.condition as StandingOrder["condition"],
  // NUMERIC wraca z PostgREST jako tekst — bez tego porównanie progu byłoby
  // porównaniem tekstu z liczbą i „5200" wychodziłoby mniejsze niż 900.
  threshold: Number(row.threshold),
  windowDays: row.window_days,
  cooldownHours: row.cooldown_hours,
  phrase: row.phrase,
  isEnabled: row.is_enabled,
  expiresAt: row.expires_at,
  lastTriggeredAt: row.last_triggered_at,
  triggerCount: row.trigger_count,
});

const sinceDate = (days: number, now: Date): string =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/** Notowania instrumentu w kształcie oczekiwanym przez ewaluator. */
async function marketSeries(db: Db, symbol: string, now: Date): Promise<SeriesPoint[]> {
  const { data } = await db
    .from("market_quotes")
    .select("quote_date, close")
    .eq("symbol", symbol)
    .gte("quote_date", sinceDate(HISTORY_DAYS, now))
    .order("quote_date", { ascending: true });
  return (data ?? []).map((r) => ({ date: r.quote_date, value: Number(r.close) }));
}

/**
 * Hurtowe ceny paliwa. Dni uzupełnione (`is_gap_fill`) są pomijane — tak samo,
 * jak robił to stary ewaluator progów paliwowych. Doklejona piątkowa cena w
 * sobotę nie jest notowaniem i policzona z niej „zmiana dzienna" albo wynosi
 * zero, albo dubluje piątkowy ruch.
 */
async function fuelSeries(db: Db, code: string, now: Date): Promise<SeriesPoint[]> {
  const product = fuelProductByCode(code);
  if (!product) return [];
  const { data } = await db
    .from("orlen_fuel_prices")
    .select("price_date, price_per_m3")
    .eq("product_id", product.id)
    .eq("is_gap_fill", false)
    .gte("price_date", sinceDate(HISTORY_DAYS, now))
    .order("price_date", { ascending: true });
  return (data ?? []).map((r) => ({ date: r.price_date, value: Number(r.price_per_m3) }));
}

/**
 * Sprawdza wszystkie aktywne rozkazy jednej dziedziny i melduje trafienia.
 *
 * Wołane przez nocne joby PO zapisaniu świeżych danych — rozkaz sprawdzony
 * przed zaciągiem oceniałby wczorajszy świat.
 *
 * Serie pobieramy raz na przedmiot, nie raz na rozkaz: trzy progi na tym
 * samym instrumencie to jedno zapytanie, nie trzy.
 */
export async function evaluateStandingOrders(
  db: Db,
  subjectKind: SubjectKind,
  now: Date = new Date(),
): Promise<OrderRunSummary> {
  const summary: OrderRunSummary = { checked: 0, triggered: 0, skipped: 0, errors: [] };

  const { data: rows, error } = await db
    .from("standing_orders")
    // Jeden literał, nie sklejenie: z treści tego napisu klient Supabase
    // wyprowadza typ wiersza.
    .select(
      "id, owner_id, subject_kind, subject, condition, threshold, window_days, cooldown_hours, phrase, is_enabled, expires_at, last_triggered_at, trigger_count",
    )
    .eq("subject_kind", subjectKind)
    .eq("is_enabled", true);

  if (error) {
    summary.errors.push(`odczyt rozkazów: ${error.message}`);
    return summary;
  }
  if (!rows || rows.length === 0) return summary;

  const seriesCache = new Map<string, SeriesPoint[]>();

  for (const row of rows as OrderRow[]) {
    summary.checked += 1;
    const order = toOrder(row);

    let points = seriesCache.get(order.subject);
    if (!points) {
      points =
        subjectKind === "market"
          ? await marketSeries(db, order.subject, now)
          : await fuelSeries(db, order.subject, now);
      seriesCache.set(order.subject, points);
    }
    if (points.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const hit = evaluateOrder(order, points, now);
    if (!hit) continue;

    const labels = labelsFor(order.subjectKind, order.subject);
    const { title, body } = formatHit(hit, labels);

    const result = await notifyOwner(db, row.owner_id, {
      kind: "standing_order",
      title,
      body,
      // Kliknięcie w powiadomienie na telefonie ma otworzyć moduł, którego
      // rozkaz dotyczy, a nie stronę główną.
      url: order.subjectKind === "market" ? "/rynki" : "/paliwa",
      // Znacznik per rozkaz: drugi meldunek z tego samego rozkazu zastępuje
      // poprzedni na ekranie, zamiast budować stos identycznych wpisów.
      tag: `order-${order.id}`,
      payload: {
        order_id: order.id,
        subject_kind: order.subjectKind,
        subject: order.subject,
        condition: order.condition,
        threshold: order.threshold,
        value: hit.value,
        value_date: hit.valueDate,
        change_pct: hit.changePct,
        change_abs: hit.changeAbs,
        // Dokąd zabrać użytkownika po kliknięciu w meldunek.
        url: order.subjectKind === "market" ? "/rynki" : "/paliwa",
      } as unknown as Json,
    });

    if (result.error) {
      summary.errors.push(`meldunek ${order.subject}: ${result.error}`);
      continue;
    }

    // Znacznik wyciszenia ustawiamy dopiero PO udanym zapisie meldunku —
    // inaczej nieudane powiadomienie wyciszyłoby rozkaz na całą dobę i
    // użytkownik nie dowiedziałby się o ruchu ani teraz, ani jutro.
    const { error: stampError } = await db
      .from("standing_orders")
      .update({
        last_triggered_at: now.toISOString(),
        trigger_count: order.triggerCount + 1,
      })
      .eq("id", order.id);
    if (stampError) summary.errors.push(`znacznik ${order.subject}: ${stampError.message}`);

    summary.triggered += 1;
  }

  return summary;
}
