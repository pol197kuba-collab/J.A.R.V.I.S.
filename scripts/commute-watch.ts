/**
 * Alert o opóźnieniu dojazdu — uruchamiany przez .github/workflows/
 * commute-watch.yml (wywołuje go pg_cron przez workflow_dispatch, patrz
 * supabase/migrations/20261110091000_commute_watch_dispatch.sql).
 *
 * Skrypt jest CIENKI: decyzja „czy budzić telefon” siedzi w
 * src/lib/commute/alert.ts (czysta, z testami), liczenie trasy w
 * src/lib/commute/*. Tutaj są tylko odczyt stanu i zapis.
 *
 * Etap 6b: brak klucza TomTom (albo nieudany odczyt kluczy) to AWARIA —
 * czerwony przebieg i wpis w system_events. Od etapu 5 do 6b ten job przez
 * pół dnia nie miał klucza i był zielony. Uwierzytelnienie tylko service role
 * (src/lib/jobs/jobRun.ts).
 */
import type { Json } from "../src/integrations/supabase/types";
import { decideAlert, inWatchWindow, type AlertState } from "../src/lib/commute/alert";
import { commuteFacts } from "../src/lib/commute/brief";
import { computeCommute, loadCommuteSettings } from "../src/lib/commute/commute.server";
import { notifyOwner } from "../src/lib/notifications/notify.server";
import type { CommuteDirection } from "../src/lib/commute/types";
import { startJob } from "../src/lib/jobs/jobRun";

const DIRECTION_PL: Record<CommuteDirection, string> = { to: "do pracy", back: "do domu" };

async function main(): Promise<number> {
  const job = startJob("commute-watch");
  const { db, ownerId } = job;

  const settings = await loadCommuteSettings(db, ownerId);
  if (!settings.home || !settings.work) {
    return job.finish("Brak adresów domu i pracy w Ustawieniach → Dojazd — nic do sprawdzenia.");
  }

  const { data: row } = await db
    .from("commute_settings")
    .select("alert_state")
    .eq("owner_id", ownerId)
    .maybeSingle();
  let state = (row?.alert_state ?? {}) as AlertState;

  const now = new Date();
  const done: string[] = [];
  for (const direction of ["to", "back"] as CommuteDirection[]) {
    if (!inWatchWindow(now, direction, settings)) continue;
    const label = `dojazd ${DIRECTION_PL[direction]}`;
    try {
      const outcome = await computeCommute(db, ownerId, direction, now, settings);
      if (!outcome.ok) {
        await job.fail(
          label,
          outcome.reason === "no_key"
            ? "brak klucza TomTom (Ustawienia → Klucze API) — alert nie może działać"
            : "brak adresów domu i pracy",
        );
        continue;
      }
      const facts = commuteFacts(outcome.result, settings);
      const decision = decideAlert(direction, facts, settings, state, now);
      state = decision.state;
      job.notice(
        `${label}: ${facts.durationMin} min, opóźnienie ${facts.delayMin ?? "?"} min — ` +
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
        if (res.error) await job.fail(`${label} — meldunek`, res.error);
        else if (res.push?.skipped === "secrets_read_failed") {
          await job.fail(`${label} — push`, "nie udało się odczytać kluczy VAPID");
        }
        done.push(`${label}: ${facts.durationMin} min, alert wysłany`);
      } else {
        done.push(`${label}: ${facts.durationMin} min, bez alertu`);
      }
    } catch (err) {
      await job.fail(label, err instanceof Error ? err.message : String(err));
    }
  }

  await db
    .from("commute_settings")
    .update({ alert_state: state as unknown as Json })
    .eq("owner_id", ownerId);

  return job.finish(
    done.length > 0
      ? `Sprawdzono — ${done.join("; ")}.`
      : job.failures.length > 0
        ? "Dojazdu nie udało się sprawdzić."
        : "Poza oknem dojazdu — nic do sprawdzenia.",
  );
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.log(
      `::error::Nieobsłużony błąd: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(1);
  });
