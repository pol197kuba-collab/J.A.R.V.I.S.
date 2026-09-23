/**
 * Poranny briefing — uruchamiany przez .github/workflows/morning-brief.yml
 * (i ręcznie: `npx tsx scripts/morning-brief.ts --dry-run`).
 *
 * KIEDY BIEGNIE. Co godzinę — ale rubrykę składa dopiero przy pierwszym
 * przebiegu po godzinie WYBRANEJ PRZEZ UŻYTKOWNIKA (user_settings.brief_hour,
 * czas lokalny). Harmonogram GitHub Actions jest jeden dla wszystkich i nie
 * da się go ustawić per konto, więc wybór godziny musi być decyzją w kodzie,
 * a nie w cronie.
 *
 * Przy okazji KAŻDEGO przebiegu (także tego, który briefingu nie składa) job
 * podnosi porzucone zadania dokumentowe — potok prezentacji jest odpalany
 * przez przeglądarkę, więc zamknięcie aplikacji w trakcie zostawiało je
 * martwe na zawsze. To jedyne miejsce, które dokańcza je bez użytkownika.
 *
 * Notowania w rubryce są z wieczornego przebiegu poprzedniego dnia — i tak
 * mają być: rano giełdy jeszcze nie otworzyły, a briefing ma opisywać
 * zamkniętą sesję, nie połowę następnej.
 *
 * Skrypt jest CIENKI: cała logika siedzi w src/lib/brief/*, pokryta testami
 * i używana też przez server function „złóż briefing teraz". Tutaj są
 * wyłącznie sekrety, uwierzytelnienie i raport.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import { buildDailyBrief } from "../src/lib/brief/build.server";
import { gatherFacts } from "../src/lib/brief/facts.server";
import { composeBrief } from "../src/lib/brief/compose";
import { decideBriefRun, DEFAULT_BRIEF_HOUR } from "../src/lib/brief/schedule";
import { rescueDocumentJobs } from "../src/lib/agents/documentJobs.rescue";
import { warsawDate, warsawHour } from "../src/lib/format/warsaw";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

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
  const supabaseUrl = requireEnv("SUPABASE_URL");

  // Klucze modeli są opcjonalne. Bez nich briefing powstaje z samych liczb —
  // uboższy język, ten sam komplet informacji. To nie jest awaria.
  const keys = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  };
  if (!keys.anthropicApiKey && !keys.geminiApiKey) {
    warn("Brak kluczy modeli — briefing zostanie złożony z samych liczb.");
  }

  // Dwie drogi uwierzytelnienia, identycznie jak w pozostałych jobach:
  // service_role omija RLS, logowanie kontem działa tam, gdzie właściciel
  // nie ma do service_role dostępu. Briefing jest PER UŻYTKOWNIK, więc to
  // konto decyduje, czyje zadania, rozkazy i watchlista trafią do rubryki.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  let db;
  let ownerId: string;

  if (serviceRoleKey) {
    db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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
    db = client;
    ownerId = session.user.id;
    notice(`Uwierzytelnienie: konto ${email}.`);
  } else {
    fail(
      "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
        "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    // Podgląd: zbieramy fakty i składamy tekst, ale niczego nie zapisujemy
    // i nie wołamy modelu — służy do sprawdzenia, czy briefing ma z czego
    // powstać, zanim zacznie budzić kogokolwiek powiadomieniem.
    const facts = await gatherFacts(db, ownerId);
    const composed = composeBrief(facts);
    console.log(`[dry-run] ${composed.greeting}`);
    for (const section of composed.sections) {
      console.log(`[dry-run] ${section.heading}:`);
      for (const line of section.lines) console.log(`[dry-run]   ${line}`);
    }
    if (composed.sections.length === 0) console.log("[dry-run] (spokojny dzień, brak sekcji)");
    notice("Tryb dry-run — nic nie zostało zapisane i nie wołano modelu.");
    return;
  }

  // ---------- Ratownik zadań dokumentowych ----------
  // PRZED sprawdzeniem godziny briefingu i niezależnie od niego: potok
  // dokumentów jest odpalany przez przeglądarkę, więc zamknięcie aplikacji
  // w trakcie zostawia zadanie martwe. Ten przebieg jest jedynym miejscem,
  // które podniesie je bez udziału użytkownika — więc biegnie co godzinę,
  // a nie raz dziennie o siódmej.
  try {
    const rescue = await rescueDocumentJobs(db, ownerId);
    for (const message of rescue.errors) warn(`zadania dokumentowe: ${message}`);
    if (rescue.resumed > 0 || rescue.failed > 0) {
      notice(
        `zadania dokumentowe: ${rescue.resumed} wznowionych, ${rescue.failed} zamkniętych jako nieudane`,
      );
    }
  } catch (err) {
    warn(`zadania dokumentowe: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------- Czy to już ta godzina ----------
  // Job biegnie CO GODZINĘ, bo harmonogram GitHuba jest jeden dla wszystkich,
  // a godzina briefingu należy do użytkownika. Ta decyzja jest czysta i
  // przetestowana (src/lib/brief/schedule.ts) — tutaj tylko odczyt ustawień.
  const { data: settings } = await db
    .from("user_settings")
    .select("brief_hour, brief_push")
    .eq("owner_id", ownerId)
    .maybeSingle();

  const schedule = {
    hour: settings?.brief_hour ?? DEFAULT_BRIEF_HOUR,
    push: settings?.brief_push ?? true,
  };

  const { data: lastBrief } = await db
    .from("daily_briefs")
    .select("brief_date")
    .eq("owner_id", ownerId)
    .order("brief_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date();
  const decision = decideBriefRun(schedule, now, lastBrief?.brief_date ?? null);
  if (!decision.run) {
    notice(
      decision.reason === "already_built"
        ? `Rubryka na ${warsawDate(now)} już istnieje — pomijam.`
        : `Jest ${warsawHour(now)}:00 czasu lokalnego, briefing zamówiony na ${schedule.hour}:00 — za wcześnie.`,
    );
    return;
  }

  try {
    const { brief, notified, error } = await buildDailyBrief(db, ownerId, keys, {
      notify: true,
      push: schedule.push,
    });

    if (error) {
      fail(`Zapis briefingu: ${error}`);
      try {
        await db.from("system_events").insert({
          owner_id: ownerId,
          level: "error",
          source: "morning-brief",
          message: `[cron] zapis briefingu: ${error}`,
          meta: {} as Json,
        });
      } catch {
        // Zostaje ::error:: powyżej.
      }
      process.exit(1);
    }

    notice(
      `briefing ${brief.date}: ${brief.sections.length} sekcji, ` +
        `tekst: ${brief.generatedBy}` +
        (notified ? ", meldunek zapisany" : ", BEZ meldunku") +
        (schedule.push ? "" : " (tryb cichy — bez powiadomienia na urządzenia)"),
    );
    // Brak powiadomienia przy udanym zapisie znaczy, że briefing jest, ale
    // nikt się o nim nie dowie — warto, żeby było to widać w przebiegu.
    if (!notified) warn("Briefing zapisany, ale meldunek się nie zapisał.");
  } catch (err) {
    fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  }

  notice("Przebieg zakończony bez awarii.");
}

main().catch((err: unknown) => {
  fail(`Nieobsłużony błąd: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
