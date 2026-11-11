// Server functions budżetu: ile wydano, na co i ile zostało.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { budgetStatus, summarizeSpend, type BudgetLevel, type SpendRow } from "./budget";
import { monthSpendRows, monthlyBudgetUsd } from "./budget.server";
import { PRICING_VERIFIED_ON } from "./pricing";

export type { SpendRow };

export type BudgetReport = {
  level: BudgetLevel;
  spentUsd: number;
  limitUsd: number;
  ratio: number;
  /** Wydatki dzisiejsze — do wychwycenia dnia, który odstaje. */
  todayUsd: number;
  /** Wywołania modeli z ceną (z księgi llm_usage). */
  runs: number;
  /** Wywołania modeli spoza cennika: policzone osobno, nie jako zero. */
  unpricedRuns: number;
  /** Podział na moduły aplikacji (czat, rynki, briefing…). */
  byModule: SpendRow[];
  byModel: SpendRow[];
  /** Data weryfikacji cennika — liczby są tyle warte, ile ona. */
  pricingVerifiedOn: string;
};

/**
 * Raport budżetu z księgi llm_usage (etap 2, A3/A12): suma i oba podziały
 * pochodzą z tych samych wierszy zsumowanych przez bazę, więc panel zawsze
 * zgadza się z kwotą, od której zależy degradacja modeli.
 */
export const getBudgetReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BudgetReport> => {
    const { supabase, userId } = context;
    const [spend, limitUsd] = await Promise.all([
      monthSpendRows(supabase, userId),
      monthlyBudgetUsd(supabase, userId),
    ]);
    if (spend.error) throw new Error(spend.error);

    const summary = summarizeSpend(spend.rows);
    const status = budgetStatus(summary.spentUsd, limitUsd);
    return {
      level: status.level,
      spentUsd: status.spentUsd,
      limitUsd: status.limitUsd,
      ratio: status.ratio,
      todayUsd: summary.todayUsd,
      runs: summary.calls - summary.unpriced,
      unpricedRuns: summary.unpriced,
      byModule: summary.byModule,
      byModel: summary.byModel,
      pricingVerifiedOn: PRICING_VERIFIED_ON,
    };
  });
