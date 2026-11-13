// Narzędzia agentów — shared. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { LedgerContext } from "@/lib/ai/llm/ledger";

export type ToolContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  /** agents.id of the agent whose run is executing this tool. */
  agentId: string;
  runId: string;
  apiKey: string;
  model: string;
  /**
   * Model widział w tej turze obcą treść (strona, dokument, plik). `remember`
   * zapisuje wtedy wpis jako origin = "tool" (A2d).
   */
  untrustedContent?: boolean;
  logEvent: (
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    meta?: Json,
  ) => Promise<void>;
};

export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolResult = Record<string, unknown>;

/** Księga zużycia modeli dla wywołań z narzędzia (moduł agents, run z kontekstu). */
export const toolLedger = (ctx: ToolContext, purpose: string): LedgerContext => ({
  db: ctx.supabase,
  ownerId: ctx.userId,
  module: "agents",
  purpose,
  runId: ctx.runId || null,
});

/**
 * Klasa ryzyka narzędzia (plan naprawczy, A2a):
 * - `read` — tylko odczyt;
 * - `write` — zapis własnych danych właściciela w bazie, odwracalny;
 * - `external` — skutek poza bazą albo nieodwracalny (usunięcie, zapis na
 *   dysku, zlecenie pracy w GitHubie). Takie narzędzie nie wykona się w
 *   turze, w której model widział już obcą treść (A2b, runtime.server.ts).
 */
export type ToolRisk = "read" | "write" | "external";

type ByArgs<T> = T | ((args: Record<string, unknown>) => T);

export type Tool = {
  declaration: ToolDeclaration;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  /** Klasa ryzyka; funkcja, gdy zależy od argumentów wywołania. */
  risk: ByArgs<ToolRisk>;
  /**
   * Czy wynik niesie treść spoza właściciela (strony WWW, wgrane dokumenty,
   * pliki z dysku). Taka treść może zawierać wstrzyknięte polecenia, więc po
   * niej narzędzia `external` czekają na potwierdzenie użytkownika.
   */
  untrustedOutput?: ByArgs<boolean>;
  /**
   * Jak wyżej, ale rozstrzygane z WYNIKU — gdy obcość zależy od tego, co
   * narzędzie znalazło (np. `recall`: wpis zapisany przez narzędzie albo sprzed
   * migracji pochodzenia to obca treść, wpis właściciela — nie). Etap 6b.
   */
  untrustedResult?: (result: ToolResult) => boolean;
};

const resolveByArgs = <T>(value: ByArgs<T>, args: Record<string, unknown>): T =>
  typeof value === "function" ? (value as (a: Record<string, unknown>) => T)(args) : value;

export function toolRisk(tool: Tool, args: Record<string, unknown>): ToolRisk {
  return resolveByArgs(tool.risk, args);
}

export function bringsUntrustedContent(
  tool: Tool,
  args: Record<string, unknown>,
  result?: ToolResult,
): boolean {
  if (tool.untrustedOutput !== undefined && resolveByArgs(tool.untrustedOutput, args)) return true;
  return result !== undefined && tool.untrustedResult !== undefined && tool.untrustedResult(result);
}

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

// Strip characters that would break PostgREST's comma/paren-delimited `.or()`
// filter grammar, so a free-text query can't corrupt the query or inject
// extra filter clauses.
export const sanitizeForOrFilter = (s: string): string => s.replace(/[,()*%\\]/g, " ").trim();
