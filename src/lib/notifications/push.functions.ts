// Server functions Web Push: klucz publiczny dla przeglądarki, zapis i
// wyrejestrowanie subskrypcji urządzenia.
//
// Klucz PRYWATNY nigdy nie pojawia się w żadnej z tych odpowiedzi — wychodzi
// wyłącznie publiczny, bo tylko on jest przeglądarce potrzebny do
// zasubskrybowania. Prywatny zostaje po stronie serwera i podpisuje wysyłkę.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ensureVapidKeys } from "./push.server";

const ConfigInput = z
  .object({
    /** Origin aplikacji — ląduje w polu kontaktowym VAPID (RFC 8292). */
    origin: z.string().url().max(200).optional(),
  })
  .optional();

/**
 * Klucz publiczny do zasubskrybowania urządzenia; generuje parę przy
 * pierwszym wywołaniu.
 *
 * Adres kontaktowy bierzemy z originu aplikacji, a nie z adresu e-mail
 * użytkownika: usługa push widzi tę wartość, a nie ma powodu dostawać
 * czyjejś poczty.
 */
export const getPushConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConfigInput.parse(input))
  .handler(async ({ data, context }): Promise<{ publicKey: string | null }> => {
    const publicKey = await ensureVapidKeys(
      context.supabase,
      context.userId,
      data?.origin ?? "https://localhost",
    );
    return { publicKey };
  });

const SubscribeInput = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(400).optional().nullable(),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubscribeInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      {
        owner_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        // Ponowne zasubskrybowanie tego samego urządzenia to nie nowa
        // subskrypcja, tylko odświeżenie kluczy w istniejącej — przeglądarka
        // potrafi je wymienić, zachowując endpoint.
        failure_count: 0,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UnsubscribeInput = z.object({ endpoint: z.string().url().max(1000) });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnsubscribeInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Ile urządzeń właściciela jest zapisanych — do pokazania w ustawieniach. */
export const countPushSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const { count } = await context.supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId);
    return { count: count ?? 0 };
  });

// ---------- test powiadomienia i stan dostarczania briefingu ----------

export type PushTest = {
  id: string;
  requestedAt: string;
  doneAt: string | null;
  sent: number | null;
  failed: number | null;
  pruned: number | null;
  skipped: string | null;
};

/**
 * Prosi o testowe powiadomienie. Wysyła je job GitHub (tą samą drogą co
 * briefing) — wiersz w push_tests sam go wywołuje (trigger w bazie), jeśli w
 * Ustawieniach jest token GitHub; inaczej test czeka na najbliższy przebieg.
 */
export const requestPushTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string }> => {
    const { data, error } = await context.supabase
      .from("push_tests")
      .insert({ owner_id: context.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Nie udało się zlecić testu: ${error?.message ?? "?"}`);
    return { id: data.id };
  });

export const getPushTest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PushTest | null> => {
    const { data: row } = await context.supabase
      .from("push_tests")
      .select("id, requested_at, done_at, sent, failed, pruned, skipped")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!row) return null;
    return {
      id: row.id,
      requestedAt: row.requested_at,
      doneAt: row.done_at,
      sent: row.sent,
      failed: row.failed,
      pruned: row.pruned,
      skipped: row.skipped,
    };
  });

export type BriefDelivery = {
  /** Czy w Ustawieniach jest token GitHub — bez niego briefing czeka na crona. */
  hasGithubToken: boolean;
  lastBrief: { date: string; createdAt: string } | null;
  /** Ostatni zaciąg Market Grid (job_runs) — uruchamiany przez bazę o 20:00. */
  lastMarketRun: { finishedAt: string; trigger: string | null; failures: number } | null;
  /** Ostatnie wywołania joba przez bazę i odpowiedź GitHuba (204 = OK). */
  dispatches: { at: string; reason: string; status: number | null; error: string | null }[];
};

export const getBriefDelivery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BriefDelivery> => {
    const { supabase, userId } = context;
    const [{ data: secret }, { data: brief }, { data: dispatches }, { data: market }] =
      await Promise.all([
        supabase.from("user_secrets").select("github_token").eq("owner_id", userId).maybeSingle(),
        supabase
          .from("daily_briefs")
          .select("brief_date, created_at")
          .eq("owner_id", userId)
          .order("brief_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc("job_dispatch_status"),
        supabase
          .from("job_runs")
          .select("finished_at, trigger, failures")
          .eq("owner_id", userId)
          .eq("workflow", "market-grid.yml")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    return {
      hasGithubToken: Boolean(secret?.github_token?.trim()),
      lastBrief: brief ? { date: brief.brief_date, createdAt: brief.created_at } : null,
      lastMarketRun: market
        ? { finishedAt: market.finished_at, trigger: market.trigger, failures: market.failures }
        : null,
      dispatches: (dispatches ?? []).map((d) => ({
        at: d.created_at,
        reason: d.reason,
        status: d.status_code ?? null,
        error: d.error ?? null,
      })),
    };
  });
