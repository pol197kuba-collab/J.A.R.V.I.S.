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
import { ORLEN_PRODUCTS } from "../src/lib/fuel/orlen";
import { ingestMarket, ingestNews, ingestPrices, type Db } from "../src/lib/fuel/ingest.server";
import { evaluateStandingOrders } from "../src/lib/orders/evaluate.server";

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
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || null;
  if (!geminiKey) {
    warn("Brak GEMINI_API_KEY — newsy dostaną ocenę heurystyczną zamiast streszczeń po polsku.");
  }

  // Dwie drogi uwierzytelnienia, w kolejności preferencji:
  //
  // 1. service_role — omija RLS, nic nie zależy od kont użytkowników.
  // 2. Logowanie kontem (klucz anon + e-mail i hasło) — dla instalacji,
  //    w których Supabase jest zarządzany przez Lovable i service_role jest
  //    poza zasięgiem właściciela. Dokładnie to robi local-worker/worker.py.
  //    Zapis działa wtedy dzięki politykom z migracji 20260920140000.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  let db: Db;
  let ownerId: string;

  if (serviceRoleKey) {
    db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as Db;
    // Przy service_role nie ma sesji, z której dałoby się wziąć właściciela,
    // więc musi go podać sekret.
    ownerId = requireEnv("JARVIS_OWNER_ID");
    notice("Uwierzytelnienie: service_role.");
  } else if (anonKey && email && password) {
    const client = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !session.user) {
      fail(`Logowanie kontem ${email} nie powiodło się: ${error?.message ?? "brak użytkownika"}`);
      process.exit(1);
    }
    db = client as Db;
    // Właściciel bierze się z sesji — jeden sekret mniej do utrzymania.
    ownerId = session.user.id;
    notice(`Uwierzytelnienie: konto ${email}.`);
  } else {
    fail(
      "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
        "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
    );
    process.exit(1);
  }

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

  // ---------- 4. Stałe rozkazy ----------
  // Progi paliwowe nie są już liczone tutaj: od migracji 20260922100000
  // mieszkają w `standing_orders` razem z rozkazami rynkowymi i ocenia je
  // jeden wspólny ewaluator. Dzięki temu „powiadom mnie, gdy ON spadnie
  // poniżej 5200" i „powiadom mnie, gdy Bitcoin tąpnie o 5%" to ten sam
  // mechanizm, a nie dwa podobne.
  try {
    const orders = await evaluateStandingOrders(db, "fuel");
    for (const message of orders.errors) await report("rozkazy", message);
    notice(
      `rozkazy: ${orders.triggered} z ${orders.checked} wyzwolonych` +
        (orders.skipped > 0 ? `, ${orders.skipped} bez danych` : ""),
    );
  } catch (err) {
    await report("rozkazy", err instanceof Error ? err.message : String(err));
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
