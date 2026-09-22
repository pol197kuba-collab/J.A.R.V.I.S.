// Server functions stałych rozkazów — lista, założenie, wyciszenie,
// odwołanie. Panel w /rynki i /paliwa woła wyłącznie te cztery.
//
// Sama logika zapisu siedzi w mutate.server.ts, bo dzieli ją z narzędziem
// agenta (rozkaz wydany głosem musi powstać dokładnie tak samo jak wydany
// formularzem). Tutaj zostaje to, co należy do warstwy HTTP: walidacja
// wejścia i związanie rozkazu z zalogowanym użytkownikiem.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ORDER_CONDITIONS, type OrderCondition, type SubjectKind } from "./rules";
import { createOrder, listOrders, type StandingOrderView } from "./mutate.server";

export type { StandingOrderView } from "./mutate.server";

const SUBJECT_KINDS = ["market", "fuel"] as const;

/** Kształt rozkazu przyjmowany z zewnątrz — ten sam dla panelu i dla agenta. */
export const StandingOrderInput = z.object({
  subjectKind: z.enum(SUBJECT_KINDS),
  subject: z.string().min(1).max(32),
  condition: z.enum(ORDER_CONDITIONS as unknown as [OrderCondition, ...OrderCondition[]]),
  threshold: z.number().positive().max(10_000_000),
  windowDays: z.number().int().min(1).max(90).optional().default(1),
  cooldownHours: z.number().int().min(1).max(720).optional().default(24),
  phrase: z.string().max(400).optional().nullable(),
  /** Liczba dni, po których rozkaz wygasa; brak = rozkaz bezterminowy. */
  expiresInDays: z.number().int().min(1).max(365).optional().nullable(),
});

const ListInput = z.object({ subjectKind: z.enum(SUBJECT_KINDS).optional() }).optional();

export const listStandingOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(
    async ({ data, context }): Promise<StandingOrderView[]> =>
      listOrders(context.supabase, context.userId, data?.subjectKind as SubjectKind | undefined),
  );

export const createStandingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StandingOrderInput.parse(input))
  .handler(
    async ({ data, context }): Promise<StandingOrderView> =>
      createOrder(context.supabase, context.userId, data),
  );

const ToggleInput = z.object({ id: z.string().uuid(), isEnabled: z.boolean() });

export const toggleStandingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ToggleInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("standing_orders")
      .update({ is_enabled: data.isEnabled })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteStandingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("standing_orders")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
