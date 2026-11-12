// Budżet — odczyt wydatków z bazy. Decyzja, co z nimi zrobić, siedzi w
// budget.ts i jest pokryta testami bez bazy.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { budgetStatus, summarizeSpend, type BudgetStatus, type SpendByModuleRow } from "./budget";

type Db = SupabaseClient<Database>;

/** Domyślny limit, gdy konto nie ma jeszcze wiersza ustawień. */
export const DEFAULT_MONTHLY_BUDGET_USD = 5;

/** Pierwszy dzień bieżącego miesiąca, UTC. */
export function monthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Wydatki z księgi od początku miesiąca, zsumowane PO STRONIE BAZY
 * (funkcja llm_spend_by_module — etap 2, A3/A12). Księga obejmuje każde
 * wywołanie modelu w aplikacji, nie tylko czat.
 *
 * Wiersze z `cost_usd = NULL` (model spoza cennika) nie wchodzą do sumy, ale
 * są policzone osobno (`unpriced`) — panel mówi o nich wprost.
 */
export async function monthSpendRows(
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<{ rows: SpendByModuleRow[]; error: string | null }> {
  const { data, error } = await db.rpc("llm_spend_by_module", {
    p_owner: ownerId,
    p_since: monthStart(now),
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as SpendByModuleRow[], error: null };
}

/**
 * Wydatki właściciela od początku miesiąca.
 *
 * Źródło: księga llm_usage. Gdy funkcji w bazie jeszcze nie ma (aplikacja
 * wdrożona przed migracją), wracamy do starego liczenia z agent_runs, żeby
 * budżet nie spadł do zera.
 */
export async function monthSpendUsd(db: Db, ownerId: string, now: Date = new Date()) {
  const ledger = await monthSpendRows(db, ownerId, now);
  if (!ledger.error) {
    const s = summarizeSpend(ledger.rows);
    return {
      spentUsd: s.spentUsd,
      runs: s.calls - s.unpriced,
      error: null as string | null,
      source: "ledger" as const,
    };
  }

  const { data, error } = await db
    .from("agent_runs")
    .select("cost_usd")
    .eq("user_id", ownerId)
    .gte("created_at", monthStart(now))
    .not("cost_usd", "is", null);

  if (error) return { spentUsd: 0, runs: 0, error: error.message, source: "agent_runs" as const };

  const rows = data ?? [];
  const spentUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  return {
    spentUsd,
    runs: rows.length,
    error: null as string | null,
    source: "agent_runs" as const,
  };
}

/** Limit miesięczny właściciela; 0 znaczy „nie pilnuj". */
export async function monthlyBudgetUsd(db: Db, ownerId: string): Promise<number> {
  const { data } = await db
    .from("user_settings")
    .select("monthly_budget_usd")
    .eq("owner_id", ownerId)
    .maybeSingle();
  const value = Number(data?.monthly_budget_usd);
  return Number.isFinite(value) ? value : DEFAULT_MONTHLY_BUDGET_USD;
}

/**
 * Stan budżetu na teraz.
 *
 * Nigdy nie rzuca: wołane jest na ścieżce każdego przebiegu agenta, a awaria
 * odczytu budżetu nie może być powodem, dla którego J.A.R.V.I.S. nie
 * odpowiada. Przy błędzie zwracamy stan „w normie" — świadomie wybieramy
 * ryzyko przekroczenia limitu zamiast pewności, że system zamilknie.
 */
export async function currentBudget(
  db: Db,
  ownerId: string,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  try {
    const [spend, limit] = await Promise.all([
      monthSpendUsd(db, ownerId, now),
      monthlyBudgetUsd(db, ownerId),
    ]);
    return budgetStatus(spend.spentUsd, limit);
  } catch {
    return budgetStatus(0, 0);
  }
}
