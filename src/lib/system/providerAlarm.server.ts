// Alarm o padniętym kluczu dostawcy (zły klucz, brak środków, wyłączone API).
//
// Do tej pory taki błąd lądował tylko w system_events — agent po cichu
// przechodził na Gemini, a nocny job kończył się na zielono, więc nikt się
// nie dowiadywał, dopóki nie przejrzał logów. Tu zamieniamy go w meldunek
// (dzwonek + push), najwyżej raz na dobę dla danego dostawcy i źródła klucza.
//
// Wołane z loggerów, więc nigdy nie rzuca.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { notifyOwner } from "@/lib/notifications/notify.server";
import { findKeyFailures, providerInfo, REASON_FIX, REASON_LABEL } from "./providerKeys";

type Db = SupabaseClient<Database>;

const ALARM_KIND = "provider_alarm";
const ALARM_WINDOW_MS = 24 * 60 * 60_000;

/** Nocne joby biegną w GitHub Actions i biorą klucze z sekretów repo, nie z ustawień. */
const keyOrigin = (): "github" | "app" =>
  typeof process !== "undefined" && process.env?.GITHUB_ACTIONS === "true" ? "github" : "app";

export async function raiseProviderAlarm(
  db: Db,
  ownerId: string,
  message: string,
  source: string,
): Promise<void> {
  try {
    const failures = findKeyFailures(message);
    if (failures.length === 0) return;
    const origin = keyOrigin();
    const since = new Date(Date.now() - ALARM_WINDOW_MS).toISOString();

    for (const { provider, reason } of failures) {
      const { data: recent } = await db
        .from("notifications")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("kind", ALARM_KIND)
        .contains("payload", { provider, origin })
        .gte("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) continue;

      const where =
        origin === "github"
          ? "Popraw sekret w GitHub (repo → Settings → Secrets → Actions)."
          : "Popraw klucz w Ustawieniach → Klucze API.";
      await notifyOwner(db, ownerId, {
        kind: ALARM_KIND,
        title: `Klucz ${providerInfo(provider).label}: ${REASON_LABEL[reason]}`,
        body: `${providerInfo(provider).ifBroken} ${REASON_FIX[reason]} ${where}`,
        payload: { provider, reason, origin, source } as Json,
        url: "/settings",
        tag: `${ALARM_KIND}:${provider}`,
      });
    }
  } catch {
    // Alarm jest dodatkiem do logu — jego awaria nie może przerwać wołającego.
  }
}
