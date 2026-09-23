// Server functions budżetu: ile wydano, na co i ile zostało.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { budgetStatus, type BudgetLevel } from "./budget";
import { monthStart, monthlyBudgetUsd } from "./budget.server";
import { bareModelId, PRICING_VERIFIED_ON } from "./pricing";

export type SpendRow = { key: string; label: string; costUsd: number; runs: number };

export type BudgetReport = {
  level: BudgetLevel;
  spentUsd: number;
  limitUsd: number;
  ratio: number;
  /** Wydatki dzisiejsze — do wychwycenia dnia, który odstaje. */
  todayUsd: number;
  runs: number;
  /** Przebiegi modeli spoza cennika: policzone osobno, nie jako zero. */
  unpricedRuns: number;
  byModel: SpendRow[];
  byAgent: SpendRow[];
  /** Data weryfikacji cennika — liczby są tyle warte, ile ona. */
  pricingVerifiedOn: string;
};

/** Największe pozycje na wierzchu; drobnica i tak nie zmieni decyzji. */
const sortBySpend = (rows: SpendRow[]): SpendRow[] =>
  [...rows].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8);

export const getBudgetReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BudgetReport> => {
    const { supabase, userId } = context;
    const now = new Date();

    const [{ data: runs, error }, limitUsd] = await Promise.all([
      supabase
        .from("agent_runs")
        .select("cost_usd, model, created_at, agent_id")
        .eq("user_id", userId)
        .gte("created_at", monthStart(now)),
      monthlyBudgetUsd(supabase, userId),
    ]);
    if (error) throw new Error(error.message);

    const { data: agents } = await supabase
      .from("agents")
      .select("id, name")
      .eq("owner_id", userId);
    const agentName = new Map((agents ?? []).map((a) => [a.id, a.name]));

    const todayPrefix = now.toISOString().slice(0, 10);
    const byModel = new Map<string, SpendRow>();
    const byAgent = new Map<string, SpendRow>();
    let spentUsd = 0;
    let todayUsd = 0;
    let priced = 0;
    let unpricedRuns = 0;

    for (const run of runs ?? []) {
      // NULL to „model spoza cennika", nie „za darmo" — liczymy takie
      // przebiegi osobno, żeby panel mógł o nich powiedzieć wprost.
      if (run.cost_usd === null || run.cost_usd === undefined) {
        unpricedRuns += 1;
        continue;
      }
      const cost = Number(run.cost_usd);
      spentUsd += cost;
      priced += 1;
      if (run.created_at?.slice(0, 10) === todayPrefix) todayUsd += cost;

      const modelKey = bareModelId(run.model ?? "—");
      const m = byModel.get(modelKey) ?? { key: modelKey, label: modelKey, costUsd: 0, runs: 0 };
      m.costUsd += cost;
      m.runs += 1;
      byModel.set(modelKey, m);

      const aKey = run.agent_id ?? "—";
      const a = byAgent.get(aKey) ?? {
        key: aKey,
        label: agentName.get(aKey) ?? "—",
        costUsd: 0,
        runs: 0,
      };
      a.costUsd += cost;
      a.runs += 1;
      byAgent.set(aKey, a);
    }

    const status = budgetStatus(spentUsd, limitUsd);
    return {
      level: status.level,
      spentUsd: status.spentUsd,
      limitUsd: status.limitUsd,
      ratio: status.ratio,
      todayUsd,
      runs: priced,
      unpricedRuns,
      byModel: sortBySpend([...byModel.values()]),
      byAgent: sortBySpend([...byAgent.values()]),
      pricingVerifiedOn: PRICING_VERIFIED_ON,
    };
  });
