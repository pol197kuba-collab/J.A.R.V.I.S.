// Darwin — wybór wariantu promptu na jeden bieg (runtime agentów i typer).
//
// Zasada bezpieczeństwa: każdy błąd bazy (np. migracja jeszcze nie weszła)
// kończy się null — wołający używa wtedy zwykłego promptu, jak przed
// Darwinem. Losowanie nie może zatrzymać agenta ani prognozy.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { pickArm, type Arm, type LiveStatus, type Rng } from "./bandit";

type Db = SupabaseClient<Database>;

export type ChosenVariant = { id: string; prompt: string };

const GEN0_NOTE = "Pokolenie 0 — prompt sprzed Darwina.";

async function loadLive(
  supabase: Db,
  ownerId: string,
  slug: string,
): Promise<{ id: string; status: LiveStatus; prompt: string }[] | null> {
  const { data, error } = await supabase
    .from("agent_variants")
    .select("id, status, prompt")
    .eq("owner_id", ownerId)
    .eq("agent_slug", slug)
    .in("status", ["champion", "active"]);
  if (error) return null;
  return (data ?? []).filter(
    (v): v is { id: string; status: LiveStatus; prompt: string } =>
      v.status === "champion" || v.status === "active",
  );
}

/**
 * Wariant na ten bieg. `baseline` podany = gdy agent nie ma jeszcze żadnego
 * wariantu, obecny prompt zostaje zapisany jako champion pokolenia 0 (żeby
 * zbierał oceny i był rodzicem pierwszych mutacji). Zapisany wariant jest
 * odtąd zamrożony — późniejsza zmiana promptu w kodzie go nie rusza.
 */
export async function chooseVariant(
  supabase: Db,
  ownerId: string,
  slug: string,
  opts: { baseline?: string; rng?: Rng } = {},
): Promise<ChosenVariant | null> {
  try {
    let live = await loadLive(supabase, ownerId, slug);
    if (live === null) return null;

    if (live.length === 0) {
      if (!opts.baseline) return null;
      const { error } = await supabase.from("agent_variants").insert({
        owner_id: ownerId,
        agent_slug: slug,
        generation: 0,
        prompt: opts.baseline,
        status: "champion",
        promoted_at: new Date().toISOString(),
        mutation_note: GEN0_NOTE,
      });
      // 23505 = równoległy bieg zdążył pierwszy (unikalny champion) — bierzemy jego.
      if (error && error.code !== "23505") return null;
      live = await loadLive(supabase, ownerId, slug);
      if (!live || live.length === 0) return null;
    }

    if (live.length === 1) return { id: live[0].id, prompt: live[0].prompt };

    const { data: stats, error } = await supabase.rpc("agent_variant_stats", {
      p_owner: ownerId,
      p_slug: slug,
    });
    const byId = new Map((error ? [] : (stats ?? [])).map((s) => [s.variant_id, s]));
    const arms: Arm[] = live.map((v) => ({
      id: v.id,
      status: v.status,
      n: Number(byId.get(v.id)?.n ?? 0),
      total: Number(byId.get(v.id)?.total ?? 0),
    }));
    const id = pickArm(arms, opts.rng ?? Math.random);
    const chosen = live.find((v) => v.id === id);
    return chosen ? { id: chosen.id, prompt: chosen.prompt } : null;
  } catch {
    return null;
  }
}
