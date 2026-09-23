// Budżet — odczyt wydatków z bazy. Decyzja, co z nimi zrobić, siedzi w
// budget.ts i jest pokryta testami bez bazy.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { budgetStatus, type BudgetStatus } from "./budget";

type Db = SupabaseClient<Database>;

/** Domyślny limit, gdy konto nie ma jeszcze wiersza ustawień. */
export const DEFAULT_MONTHLY_BUDGET_USD = 5;

/** Pierwszy dzień bieżącego miesiąca, UTC. */
export function monthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Wydatki właściciela od początku miesiąca.
 *
 * Sumujemy WYŁĄCZNIE przebiegi z policzonym kosztem. Przebieg modelu spoza
 * cennika ma `cost_usd = NULL` i jest tu pomijany — to celowe i nie jest
 * cichym zaniżaniem, bo panel pokazuje takie przebiegi osobno. Wliczenie ich
 * jako zera byłoby dopiero kłamstwem.
 */
export async function monthSpendUsd(db: Db, ownerId: string, now: Date = new Date()) {
  const { data, error } = await db
    .from("agent_runs")
    .select("cost_usd")
    .eq("user_id", ownerId)
    .gte("created_at", monthStart(now))
    .not("cost_usd", "is", null);

  if (error) return { spentUsd: 0, runs: 0, error: error.message };

  const rows = data ?? [];
  const spentUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  return { spentUsd, runs: rows.length, error: null as string | null };
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
