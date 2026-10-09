// Agent Town → the notification bell. When a command you gave in Town
// finishes, its result is pinned on the board in the Core; this also lights
// the bell, so you see it from any screen. Silent: no phone push — you were
// in the app when you gave the command, and a push for every result would be
// noise.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyOwner } from "./notify.server";

const Input = z.object({
  runId: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  text: z.string().max(4000),
  ok: z.boolean(),
});

export const notifyTownResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string | null }> => {
    const { supabase, userId } = context;
    // One entry per run, even with Town open in two tabs.
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("owner_id", userId)
      .eq("kind", "town_result")
      .contains("payload", { runId: data.runId })
      .limit(1)
      .maybeSingle();
    if (existing) return { id: existing.id };
    const body = data.text.length > 280 ? `${data.text.slice(0, 279)}…` : data.text;
    const res = await notifyOwner(supabase, userId, {
      kind: "town_result",
      title: `${data.ok ? "Wynik na tablicy" : "Błąd zadania"}: ${data.title}`,
      body,
      payload: { runId: data.runId, ok: data.ok, url: "/town" },
      silent: true,
    });
    if (res.error) throw new Error(res.error);
    return { id: res.id };
  });
