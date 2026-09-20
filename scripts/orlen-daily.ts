/**
 * Nocny zaciąg modułu paliwowego — uruchamiany przez
 * .github/workflows/orlen-prices.yml (i ręcznie: `npx tsx
 * scripts/orlen-daily.ts --dry-run`).
 *
 * Skrypt jest CIENKI z rozmysłem: cała logika siedzi w src/lib/fuel/*,
 * pokryta testami vitest i używana też przez server functions. Tutaj są
 * wyłącznie: odczyt sekretów, kolejność kroków, izolacja błędów i raport.
 *
 * Każdy krok jest w osobnym try/catch — awaria newsów nie może zablokować
 * zapisu cen, bo to ceny są powodem, dla którego ten job istnieje. Ale
 * każda awaria kończy się niezerowym kodem wyjścia, żeby zakładka Actions
 * świeciła na czerwono zamiast cicho przepuszczać zepsuty przebieg.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import { ORLEN_PRODUCTS, productById } from "../src/lib/fuel/orlen";
import {
  evaluateAlerts,
  ingestMarket,
  ingestNews,
  ingestPrices,
  type Db,
} from "../src/lib/fuel/ingest.server";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FULL = args.has("--backfill") || process.env.ORLEN_BACKFILL === "true";

function notice(message: string) {
  console.log(`::notice::${message}`);
}
function warn(message: string) {
  console.log(`::warning::${message}`);
}
function fail(message: string) {
  console.log(`::error::${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Brak wymaganego sekretu ${name}. Ustaw go w Settings → Secrets → Actions.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    // Tryb podglądu: odpytujemy źródła, ale niczego nie zapisujemy — służy
    // do sprawdzenia, czy API Orlenu, Yahoo i NBP nadal odpowiadają tym,
    // czego oczekują parsery, bez dotykania produkcyjnej bazy.
    const { fetchProductPrices } = await import("../src/lib/fuel/ingest.server");
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    for (const product of ORLEN_PRODUCTS) {
      try {
        const { points, rejected } = await fetchProductPrices(product, from, today);
        const last = points[points.length - 1];
        console.log(
          `[dry-run] ${product.code.padEnd(10)} ${points.length} punktów, ${rejected} odrzuconych` +
            (last ? `, ostatni: ${last.date} = ${last.price} PLN/m³` : ""),
        );
      } catch (err) {
        fail(`[dry-run] ${product.code}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    notice("Tryb dry-run — nic nie zostało zapisane do bazy.");
    return;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ownerId = requireEnv("JARVIS_OWNER_ID");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || null;
  if (!geminiKey) {
    warn("Brak GEMINI_API_KEY — newsy dostaną ocenę heurystyczną zamiast streszczeń po polsku.");
  }

  const db = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as Db;

  const failures: string[] = [];

  /** Zapisuje awarię tak, żeby była widoczna i w Actions, i w /system-logs. */
  async function report(step: string, message: string, meta: Json = {}) {
    failures.push(`${step}: ${message}`);
    fail(`${step}: ${message}`);
    try {
      await db.from("system_events").insert({
        owner_id: ownerId,
        level: "error",
        source: "orlen-fuel",
        message: `[cron] ${step}: ${message}`,
        meta,
      });
    } catch {
      // Jeśli nawet log nie przechodzi, zostaje ::error:: powyżej.
    }
  }

  // ---------- 1. Ceny ----------
  try {
    const summaries = await ingestPrices(db, { full: FULL });
    for (const s of summaries) {
      if (s.error)
        await report("ceny", `${s.product} — ${s.error}`, { summaries } as unknown as Json);
      else
        notice(
          `ceny ${s.product}: pobrano ${s.fetched}, zapisano ${s.written}, odrzucono ${s.rejected}`,
        );
    }
  } catch (err) {
    await report("ceny", err instanceof Error ? err.message : String(err));
  }

  // ---------- 2. Rynek ----------
  try {
    const market = await ingestMarket(db, { days: FULL ? 730 : 90 });
    if (market.error) await report("rynek", market.error);
    else notice(`rynek: Brent ${market.brent} punktów, USD/PLN ${market.usdPln} punktów`);
  } catch (err) {
    await report("rynek", err instanceof Error ? err.message : String(err));
  }

  // ---------- 3. Newsy ----------
  try {
    const news = await ingestNews(db, geminiKey);
    if (news.error) await report("newsy", news.error);
    else
      notice(
        `newsy: ${news.fetched} pobranych, ${news.fresh} nowych (ocena: ${news.classifiedBy})`,
      );
  } catch (err) {
    await report("newsy", err instanceof Error ? err.message : String(err));
  }

  // ---------- 4. Alerty ----------
  try {
    const hits = await evaluateAlerts(db);
    for (const hit of hits) {
      const product = productById(hit.productId);
      const name = product?.label ?? `produkt ${hit.productId}`;
      const body =
        hit.kind === "daily_change_abs"
          ? `Zmiana dobowa ${hit.change > 0 ? "+" : ""}${hit.change} PLN/m³ przy progu ${hit.threshold}.`
          : `Cena ${hit.price} PLN/m³ przekroczyła próg ${hit.threshold}.`;

      const { error } = await db.from("notifications").insert({
        owner_id: hit.ownerId,
        kind: "fuel_alert",
        title: `${name}: próg cenowy`,
        body,
        payload: {
          product_id: hit.productId,
          price: hit.price,
          change: hit.change,
          threshold: hit.threshold,
          alert_kind: hit.kind,
        } as unknown as Json,
      });
      if (error) {
        await report("alerty", `zapis powiadomienia: ${error.message}`);
        continue;
      }

      // Znacznik ustawiany dopiero PO udanym zapisie — inaczej nieudane
      // powiadomienie wyciszyłoby alert na całą dobę.
      await db
        .from("fuel_price_alerts")
        .update({ last_triggered_at: new Date().toISOString() })
        .eq("id", hit.alertId);
    }
    notice(`alerty: ${hits.length} przekroczonych progów`);
  } catch (err) {
    await report("alerty", err instanceof Error ? err.message : String(err));
  }

  if (failures.length > 0) {
    fail(`Przebieg zakończony z ${failures.length} błędami.`);
    process.exit(1);
  }
  notice("Przebieg zakończony bez błędów.");
}

main().catch((err: unknown) => {
  fail(`Nieobsłużony błąd: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
