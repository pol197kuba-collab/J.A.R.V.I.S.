/**
 * Poranny briefing — uruchamiany przez .github/workflows/morning-brief.yml
 * (i ręcznie: `npx tsx scripts/morning-brief.ts --dry-run`).
 *
 * KIEDY BIEGNIE I DLACZEGO AKURAT WTEDY. Po porannym zaciągu cen paliw
 * (7:30 CEST), żeby cennik na dziś był już w bazie, i przed godziną, o
 * której ktokolwiek zagląda na pulpit. Notowania są z wieczornego przebiegu
 * poprzedniego dnia — i tak mają być: rano giełdy jeszcze nie otworzyły, a
 * briefing ma opisywać zamkniętą sesję, nie połowę następnej.
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

  try {
    const { brief, notified, error } = await buildDailyBrief(db, ownerId, keys, { notify: true });

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
        (notified ? ", powiadomienie wysłane" : ", BEZ powiadomienia"),
    );
    // Brak powiadomienia przy udanym zapisie znaczy, że briefing jest, ale
    // nikt się o nim nie dowie — warto, żeby było to widać w przebiegu.
    if (!notified) warn("Briefing zapisany, ale powiadomienie się nie zapisało.");
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
