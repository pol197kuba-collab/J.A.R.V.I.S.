/**
 * Alert o opóźnieniu dojazdu — uruchamiany przez .github/workflows/
 * commute-watch.yml (wywołuje go pg_cron przez workflow_dispatch, patrz
 * supabase/migrations/20261110091000_commute_watch_dispatch.sql).
 *
 * Skrypt jest CIENKI: decyzja „czy budzić telefon” siedzi w
 * src/lib/commute/alert.ts (czysta, z testami), liczenie trasy w
 * src/lib/commute/*. Tutaj są tylko uwierzytelnienie, odczyt stanu i zapis.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import { decideAlert, inWatchWindow, type AlertState } from "../src/lib/commute/alert";
import { commuteFacts } from "../src/lib/commute/brief";
import { computeCommute, loadCommuteSettings } from "../src/lib/commute/commute.server";
import { notifyOwner } from "../src/lib/notifications/notify.server";
import type { CommuteDirection } from "../src/lib/commute/types";

const notice = (m: string) => console.log(`::notice::${m}`);
const warn = (m: string) => console.log(`::warning::${m}`);
const fail = (m: string) => console.log(`::error::${m}`);

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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  let db: ReturnType<typeof createClient<Database>>;
  let ownerId: string;
  if (serviceRoleKey) {
    db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerId = requireEnv("JARVIS_OWNER_ID");
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
  } else {
    fail(
      "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
        "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
    );
    process.exit(1);
  }

  const settings = await loadCommuteSettings(db, ownerId);
  if (!settings.home || !settings.work) {
    notice("Brak adresów domu i pracy — nic do sprawdzenia.");
    return;
  }

  const { data: row } = await db
    .from("commute_settings")
    .select("alert_state")
    .eq("owner_id", ownerId)
    .maybeSingle();
  let state = (row?.alert_state ?? {}) as AlertState;

  const now = new Date();
  for (const direction of ["to", "back"] as CommuteDirection[]) {
    if (!inWatchWindow(now, direction, settings)) continue;
    try {
      const outcome = await computeCommute(db, ownerId, direction, now, settings);
      if (!outcome.ok) {
        warn(
          `dojazd (${direction}): ${outcome.reason === "no_key" ? "brak klucza TomTom" : "brak adresów"}`,
        );
        continue;
      }
      const facts = commuteFacts(outcome.result, settings);
      const decision = decideAlert(direction, facts, settings, state, now);
      state = decision.state;
      notice(
        `dojazd (${direction}): ${facts.durationMin} min, opóźnienie ${facts.delayMin ?? "?"} min — ` +
          (decision.send ? "alert" : "bez alertu"),
      );
      if (decision.send) {
        const res = await notifyOwner(db, ownerId, {
          kind: "commute_alert",
          title: decision.title,
          body: decision.body,
          payload: {
            direction,
            durationMin: facts.durationMin,
            delayMin: facts.delayMin,
          } as unknown as Json,
          url: "/situation-room",
          tag: `commute-${direction}`,
        });
        if (res.error) warn(`meldunek: ${res.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail(`dojazd (${direction}): ${message}`);
      try {
        await db.from("system_events").insert({
          owner_id: ownerId,
          level: "error",
          source: "commute-watch",
          message: `[cron] dojazd (${direction}): ${message}`,
          meta: {} as Json,
        });
      } catch {
        // zostaje ::error:: powyżej
      }
    }
  }

  await db
    .from("commute_settings")
    .update({ alert_state: state as unknown as Json })
    .eq("owner_id", ownerId);
}

main().catch((err: unknown) => {
  fail(`Nieobsłużony błąd: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
