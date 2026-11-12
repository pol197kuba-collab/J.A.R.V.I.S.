// Typy rdzenia agentów (plan naprawczy, etap 4).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { LedgerContext } from "@/lib/ai/llm/ledger";
import type { GeminiContent, ToolDeclaration } from "@/lib/ai/llm/types";
import type { LlmUsage } from "@/lib/ai/llm/usage";
import type { UiAction } from "@/lib/constants/uiActions";
import type { Teammate } from "./prompt";

export type AgentLoopInput = {
  supabase: SupabaseClient<Database>;
  userId: string;
  agentSlug: string;
  input: string;
  history: Array<{ role: "user" | "jarvis"; text: string }>;
  /** Prevents delegate_to_agent recursion loops. */
  delegationDepth?: number;
  /** Existing conversation to append to. Omit to start a new one. */
  conversationId?: string | null;
  /** agent_runs.id of the delegating run, when this call is a delegate_to_agent hop. */
  parentRunId?: string | null;
  /**
   * Run nadrzędny widział już obcą treść (A2b) — delegat dziedziczy tę flagę,
   * więc też nie wykona akcji `external` bez potwierdzenia użytkownika.
   */
  untrustedContext?: boolean;
};

export type LogEvent = (
  level: "info" | "warn" | "error",
  source: string,
  message: string,
  meta?: Json,
) => Promise<void>;

export type ToolCallLogEntry = {
  name: string;
  args: Record<string, unknown>;
  /** Ustawione, gdy wywołanie zatrzymała bramka (A2b). */
  blocked?: "needs_confirmation";
};

/** Niezmienne dane jednego runu — wynik przygotowania (context.server.ts). */
export type RunContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  agentSlug: string;
  input: string;
  delegationDepth: number;
  isDelegatedRun: boolean;
  agent: { id: string; name: string; slug: string };
  apiKey: string;
  groqApiKey: string | null;
  anthropicApiKey: string | null;
  teammates: Teammate[];
  effectiveUiActions: string[];
  effectiveUiActionsWithNone: string[];
  systemPrompt: string;
  systemSuffix: string;
  modelRef: string;
  temperature: number;
  maxOutputTokens: number;
  maxToolIterations: number;
  conversationId: string | null;
  runId: string;
  startedAt: number;
  logEvent: LogEvent;
  runLedger: LedgerContext;
};

/** To, co pętla runu zmienia po drodze. */
export type RunState = {
  /** Oba zmienne: tura potrafi zjechać z Claude na Gemini w trakcie runu. */
  modelProvider: string;
  model: string;
  contents: GeminiContent[];
  toolDeclarations: ToolDeclaration[];
  /** Zbiór zamknięty po złożeniu deklaracji — dokładnie to, co widział model. */
  declaredToolNames: Set<string>;
  allowDelegate: boolean;
  isForge: boolean;
  forgeCalledGenerate: boolean;
  finalText: string;
  uiAction: UiAction | null;
  toolCallLog: ToolCallLogEntry[];
  /** A2b: model widział obcą treść — narzędzia `external` czekają na potwierdzenie. */
  untrustedSeen: boolean;
  /**
   * Download links captured verbatim from file-producing tool results and
   * appended to the final reply by CODE, never retyped by the model — an
   * LLM copying a ~300-char signed-URL token by hand reliably introduces
   * typos (live failure: InvalidJWT "signature verification failed" on a
   * generated pptx while the pdf's luckier copy worked).
   */
  attachments: Array<{ filename: string; url: string }>;
  /**
   * Set when open_document resolves to exactly one file — lifted from the
   * tool result (not model prose) so the id arrives intact, then returned
   * as AgentRunResult.openDocument for the client to open the preview.
   */
  openDocument: { id: string; filename: string } | null;
  /**
   * Set when generate_document made a file whose graphics still need to be
   * generated — the client kicks the background enrichment pass for it.
   */
  enrichDocument: { id: string } | null;
  /**
   * Set when queue_document_job enqueued a background Insight → Forge run —
   * the client fire-and-forgets runDocumentJobFn for it, same idiom as
   * enrichDocument above. Completion arrives later as a notification, not
   * in this turn's reply.
   */
  documentJob: { id: string } | null;
  usage: LlmUsage;
  costUsd: number;
  unpriced: boolean;
};
