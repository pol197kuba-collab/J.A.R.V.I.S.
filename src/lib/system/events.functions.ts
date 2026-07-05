// System events — real telemetry stream for the System Logs page.
// Populated by the agent runtime (tool calls, run start/finish) and any
// other server-side subsystem that wants to emit a log line.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SystemEvent = {
  id: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

const ListInput = z
  .object({ limit: z.number().int().min(1).max(500).optional().default(200) })
  .optional();

export const listSystemEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }): Promise<SystemEvent[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("system_events")
      .select("id, level, source, message, meta, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 200);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      level: r.level as SystemEvent["level"],
      source: r.source,
      message: r.message,
      meta: (r.meta ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  });

const EmitInput = z.object({
  level: z.enum(["info", "warn", "error", "debug"]).optional().default("info"),
  source: z.string().min(1).max(60),
  message: z.string().min(1).max(1000),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const emitSystemEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EmitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("system_events").insert({
      owner_id: userId,
      level: data.level,
      source: data.source,
      message: data.message,
      meta: data.meta ?? {},
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });