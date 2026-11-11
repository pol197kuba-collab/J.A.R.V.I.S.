// Księga zużycia modeli (tabela llm_usage, plan naprawczy etap 2).
//
// Każde wywołanie modelu przez klienta z src/lib/ai/llm/ dostaje opcjonalny
// `ledger` — gdzie i po co je zapisać. Zapis NIGDY nie przerywa wywołującego:
// awaria księgi nie może być powodem, dla którego J.A.R.V.I.S. nie odpowiada.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { llmCost, type LlmProvider, type LlmUsage } from "./usage";

export type LedgerContext = {
  db: SupabaseClient<Database>;
  ownerId: string;
  /** Moduł aplikacji: agents, markets, brief, vision, brain, fuel, documents, notes… */
  module: string;
  /** Cel w module: turn, classifier, web_search, forecast, embed… */
  purpose: string;
  runId?: string | null;
};

/** Ten sam kontekst z innym celem (np. embed w module notatek). */
export const withPurpose = (ledger: LedgerContext, purpose: string): LedgerContext => ({
  ...ledger,
  purpose,
});

export type LedgerEntry = {
  provider: LlmProvider;
  model: string;
  usage: LlmUsage;
  /** Tokeny oszacowane, bo dostawca ich nie podał. */
  estimated?: boolean;
};

/** Zapisuje wywołanie i zwraca jego koszt (null = model spoza cennika). */
export async function recordLlmUsage(
  ledger: LedgerContext | undefined,
  entry: LedgerEntry,
): Promise<number | null> {
  const cost = llmCost(entry.provider, entry.model, entry.usage);
  if (!ledger) return cost;
  try {
    const { error } = await ledger.db.from("llm_usage").insert({
      owner_id: ledger.ownerId,
      module: ledger.module,
      purpose: ledger.purpose,
      provider: entry.provider,
      model: entry.model,
      tokens_input: Math.round(entry.usage.input),
      tokens_output: Math.round(entry.usage.output),
      tokens_thinking: Math.round(entry.usage.thinking),
      cache_read: Math.round(entry.usage.cacheRead),
      cache_write: Math.round(entry.usage.cacheWrite),
      cost_usd: cost,
      estimated: entry.estimated ?? false,
      run_id: ledger.runId ?? null,
    });
    if (error) console.warn(`[llm_usage] zapis nieudany: ${error.message}`);
  } catch (err) {
    console.warn(`[llm_usage] zapis nieudany: ${err instanceof Error ? err.message : err}`);
  }
  return cost;
}
