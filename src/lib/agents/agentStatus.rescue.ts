// Odwieszanie agentów — warstwa z bazą.
//
// Sprząta DWIE tabele naraz i to jest sedno: widżet 3D czyta `agents`
// (kafel „ACTIVE TASK"), a drzewo delegacji czyta `agent_runs`. Posprzątanie
// tylko jednej zostawiłoby drugą świecącą — dokładnie ta pomyłka sprawiła,
// że po naprawie zadań dokumentowych matryca dalej pokazywała pracę, której
// nie było.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AGENT_STALE_AFTER_MS, isWedged, wedgedRunReason } from "./agentStatus.recovery";

type Db = SupabaseClient<Database>;

export type AgentRescueSummary = {
  /** Agenci zwolnieni z fałszywego „zajęty". */
  freed: string[];
  /** Przebiegi domknięte jako przerwane. */
  closedRuns: number;
  errors: string[];
};

/**
 * Wspólne sprzątanie jednego agenta: wiersz agenta + jego martwe przebiegi.
 *
 * `runCutoff` rozdziela dwa tryby. Automat domyka tylko przebiegi starsze od
 * progu, żeby nie dotknąć czegoś, co realnie trwa. Ręczny reset przekazuje
 * `null` i domyka WSZYSTKIE nieukończone przebiegi tego agenta — inaczej
 * zwolniłby wiersz agenta, ale zostawił przebieg rysowany w drzewie
 * delegacji jako żywy, czyli naprawiłby połowę tego, co użytkownik widzi.
 * To bezpieczne: jeśli przebieg jednak żyje, jego własne zakończenie
 * nadpisze ten wpis na „done".
 */
async function freeAgent(
  db: Db,
  ownerId: string,
  agent: { id: string; slug: string; busy_since: string | null },
  now: Date,
  runCutoff: string | null,
): Promise<{ closedRuns: number; error: string | null }> {
  const startedAt = agent.busy_since ? Date.parse(agent.busy_since) : NaN;
  const elapsed = Number.isFinite(startedAt) ? Math.round((now.getTime() - startedAt) / 1000) : 0;

  const { error } = await db
    .from("agents")
    .update({
      // 'idle', a nie 'error': agent nie zawiódł, tylko nikt go nie zwolnił.
      // Wpisanie mu błędu obciążałoby go cudzą winą i zostawiało czerwony
      // węzeł w matrycy bez żadnej awarii pod spodem.
      status: "idle",
      current_task: null,
      progress: 0,
      time_elapsed_seconds: elapsed,
      busy_since: null,
    })
    .eq("id", agent.id)
    .eq("owner_id", ownerId);

  if (error) return { closedRuns: 0, error: error.message };

  // Przebiegi tego agenta, których też nikt nie domknął. Bez tego drzewo
  // delegacji dalej rysowałoby je jako żywe.
  let query = db
    .from("agent_runs")
    .update({
      status: "error",
      error: wedgedRunReason(),
      finished_at: now.toISOString(),
    })
    .eq("agent_id", agent.id)
    .eq("user_id", ownerId)
    .in("status", ["running", "pending"]);
  if (runCutoff) query = query.lt("created_at", runCutoff);

  const { data: closed } = await query.select("id");
  return { closedRuns: closed?.length ?? 0, error: null };
}

/**
 * Znajduje i odwiesza wszystkich agentów właściciela, którzy wiszą.
 *
 * Wołane z tych samych dwóch miejsc co ratownik zadań dokumentowych: przy
 * wejściu na pulpit i w godzinnym przebiegu. Agent, który realnie pracuje,
 * nie jest ruszany — o tym decyduje `isWedged`, nie ta funkcja.
 */
export async function rescueStuckAgents(
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<AgentRescueSummary> {
  const summary: AgentRescueSummary = { freed: [], closedRuns: 0, errors: [] };

  const { data: agents, error } = await db
    .from("agents")
    .select("id, slug, status, busy_since")
    .eq("owner_id", ownerId)
    .eq("status", "busy");

  if (error) {
    summary.errors.push(`odczyt agentów: ${error.message}`);
    return summary;
  }
  if (!agents || agents.length === 0) return summary;

  for (const agent of agents) {
    if (!isWedged({ status: agent.status, busySince: agent.busy_since }, now)) continue;

    const cutoff = new Date(now.getTime() - AGENT_STALE_AFTER_MS).toISOString();
    const result = await freeAgent(db, ownerId, agent, now, cutoff);
    if (result.error) {
      summary.errors.push(`${agent.slug}: ${result.error}`);
      continue;
    }
    summary.freed.push(agent.slug);
    summary.closedRuns += result.closedRuns;
  }

  return summary;
}

/**
 * Odwiesza JEDNEGO agenta na żądanie użytkownika — bez sprawdzania progu.
 *
 * Próg czasowy chroni automat przed przerwaniem realnej pracy. Kliknięcie
 * przycisku to świadoma decyzja człowieka, który patrzy na kafel i wie, że
 * tam nic się nie dzieje — stawianie mu na drodze „jeszcze za wcześnie"
 * znaczyłoby tyle, że musi czekać dwadzieścia minut na prawo do naprawienia
 * czegoś, co widzi.
 */
export async function resetAgentStatus(
  db: Db,
  ownerId: string,
  slug: string,
  now: Date = new Date(),
): Promise<AgentRescueSummary> {
  const summary: AgentRescueSummary = { freed: [], closedRuns: 0, errors: [] };

  const { data: agent, error } = await db
    .from("agents")
    .select("id, slug, status, busy_since")
    .eq("owner_id", ownerId)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !agent) {
    summary.errors.push(`nie znam agenta „${slug}"`);
    return summary;
  }

  const result = await freeAgent(db, ownerId, agent, now, null);
  if (result.error) {
    summary.errors.push(`${agent.slug}: ${result.error}`);
    return summary;
  }
  summary.freed.push(agent.slug);
  summary.closedRuns += result.closedRuns;
  return summary;
}
