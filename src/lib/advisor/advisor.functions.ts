// DORADCA — funkcje serwerowe dla strony /rynki (przycisk „Doradca”).
//
// Logika w advisor.server.ts (dynamiczny import: klucze, baza i model nie
// trafiają do bundla klienta) i plan.ts (czysta, testowana).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { readOwnerSecrets } from "@/lib/secrets/ownerSecrets.server";
import { logServerError } from "@/lib/system/logServerError";
import { parseAdvisorSettings } from "./plan";
import { warsawClock } from "./alerts";
import type { Advice } from "./advisor.server";

export type { Advice, AdvisorJournalEntry } from "./advisor.server";

export const getAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ deep: z.boolean().optional() }).optional().parse(input),
  )
  .handler(async ({ context, data }): Promise<Advice> => {
    const { supabase, userId } = context;
    const server = await import("./advisor.server");
    try {
      if (!data?.deep) return await server.computeAdvice(supabase, userId, { withJournal: true });

      const { settings, deep } = await server.loadAdvisorSettings(supabase, userId);
      const day = warsawClock(new Date()).day;
      const used = deep.day === day ? deep.count : 0;
      if (used >= server.DEEP_PER_DAY) {
        throw new Error(`Limit głębokich analiz na dziś (${server.DEEP_PER_DAY}) wykorzystany.`);
      }
      const { data: secrets } = await readOwnerSecrets(userId, "gemini_api_key, anthropic_api_key");
      const keys = {
        anthropicApiKey: secrets?.anthropic_api_key?.trim() || null,
        geminiApiKey: secrets?.gemini_api_key?.trim() || null,
      };
      if (!keys.anthropicApiKey && !keys.geminiApiKey) {
        throw new Error("Brak klucza modelu (Ustawienia → Klucze API).");
      }
      await server.saveAdvisorSettingsRow(supabase, userId, settings, { day, count: used + 1 });
      return await server.computeAdvice(supabase, userId, { deep: keys, withJournal: true });
    } catch (err) {
      await logServerError(supabase, userId, "advisor.advice", err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

export const saveAdvisorSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ settings: z.unknown() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const server = await import("./advisor.server");
    const { deep } = await server.loadAdvisorSettings(supabase, userId);
    const settings = parseAdvisorSettings(data.settings);
    await server.saveAdvisorSettingsRow(supabase, userId, settings, deep);
    return { settings };
  });

const PlayInput = z.object({
  symbol: z.string().min(1).max(20),
  label: z.string().min(1).max(80),
  side: z.enum(["buy", "sell"]),
  strength: z.number().int().min(0).max(100),
  entry: z.number().positive(),
  stop: z.number().positive(),
  take: z.number().positive(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lots: z.number().positive().nullable(),
  units: z.number().positive().nullable(),
  snapshot: z.unknown(),
});

/** „Zagrałem” (z ceną, po jakiej faktycznie wszedłeś) albo „pomijam”. */
export const recordAdvisorAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ action: z.enum(["played", "skipped"]), play: PlayInput }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const p = data.play;
    const { error } = await supabase.from("advisor_journal").insert({
      owner_id: userId,
      symbol: p.symbol,
      label: p.label,
      side: p.side,
      action: data.action,
      status: data.action === "played" ? "open" : "closed",
      strength: p.strength,
      entry_price: p.entry,
      stop_price: p.stop,
      take_price: p.take,
      expires_on: p.expiresOn,
      lots: p.lots,
      units: p.units,
      play: (p.snapshot ?? {}) as Json,
      closed_reason: data.action === "skipped" ? "pominięte" : null,
      closed_at: data.action === "skipped" ? new Date().toISOString() : null,
    });
    if (error) {
      await logServerError(supabase, userId, "advisor.journal", error);
      throw new Error(error.message);
    }
    return { ok: true };
  });

/** Zamknięcie pozycji w dzienniku (zamknąłem w XTB). */
export const closeAdvisorPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("advisor_journal")
      .update({
        status: "closed",
        closed_reason: "zamknięte ręcznie",
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
