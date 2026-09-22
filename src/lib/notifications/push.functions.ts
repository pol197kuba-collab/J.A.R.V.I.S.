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
