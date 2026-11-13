// Server-only tool implementations for the J.A.R.V.I.S. core.
//
// Each tool has:
//  - `declaration`: sent to Gemini as a function declaration.
//  - `execute`: runs on our server, receives typed args, returns a small
//    JSON-serialisable result the model reads back.
//
// All tools rely exclusively on FREE upstream endpoints (Wikipedia REST /
// OpenSearch, public HTTP fetch) or the user's own Supabase row-level data.
// No paid keys are touched here.

//
// Etap 4 planu naprawczego: implementacje narzędzi mieszkają w
// src/lib/agents/tools/*.server.ts (po jednym pliku na obszar). Ten plik jest
// jedynym indeksem: ALL_TOOLS, wyszukiwanie po nazwie i rejestr z bazy.

import { type SupabaseClient } from "@supabase/supabase-js";
import { type Database } from "@/integrations/supabase/types";
import { readDailyBriefTool } from "./tools/brief.server";
import {
  listDocumentsTool,
  listGeneratedFilesTool,
  readDocumentTool,
  readGeneratedFileTool,
  searchDocumentsTool,
} from "./tools/documents.server";
import { generateDocumentTool, openDocumentTool, queueDocumentJob } from "./tools/forge.server";
import { checkDelegation, runStats, scanErrors } from "./tools/shield.server";
import { checkCommuteTool } from "./tools/commute.server";
import { fuelOutlookTool, marketOutlookTool } from "./tools/markets.server";
import { recall, remember } from "./tools/memory.server";
import { deleteNote, listNotesTool, saveNote } from "./tools/notes.server";
import { createProject, listProjects } from "./tools/projects.server";
import { type Tool } from "./tools/shared.server";
import {
  cancelStandingOrderTool,
  createStandingOrderTool,
  listStandingOrdersTool,
} from "./tools/standingOrders.server";
import { createTask, deleteTask, listTasks, updateTask } from "./tools/tasks.server";
import { fetchUrl, webSearch } from "./tools/web.server";

export { SIGNED_URL_TTL_SECONDS } from "./tools/forge.server";
export {
  type Tool,
  type ToolContext,
  type ToolDeclaration,
  type ToolResult,
  type ToolRisk,
  bringsUntrustedContent,
  toolRisk,
} from "./tools/shared.server";
export {
  FETCH_MAX_BYTES,
  FETCH_TIMEOUT_MS,
  isBlockedTarget,
  isPrivateIp,
  isTextualContentType,
} from "./tools/web.server";
// Embeddingi żyją w src/lib/ai/embed.ts (współdzielone z nocnym skryptem
// Mózgu 3D); re-eksport zostaje, bo documents.functions.ts importuje je stąd.
export { embedText, toVectorLiteral } from "@/lib/ai/embed";

export const ALL_TOOLS: Tool[] = [
  readDailyBriefTool,
  createStandingOrderTool,
  listStandingOrdersTool,
  cancelStandingOrderTool,
  marketOutlookTool,
  fuelOutlookTool,
  checkCommuteTool,
  webSearch,
  fetchUrl,
  saveNote,
  listNotesTool,
  deleteNote,
  remember,
  recall,
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  listProjects,
  createProject,
  scanErrors,
  runStats,
  checkDelegation,
  listDocumentsTool,
  searchDocumentsTool,
  readDocumentTool,
  listGeneratedFilesTool,
  readGeneratedFileTool,
  queueDocumentJob,
  generateDocumentTool,
  openDocumentTool,
];

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.declaration.name === name);
}

// ---------------------------------------------------------------------------
// DB-driven registry: which of the known tools is THIS agent allowed to call
// right now? Two independent switches must both be "on":
//   - public.tools.is_enabled       — global kill switch (admin-managed)
//   - public.agent_tools.is_enabled — per-agent toggle (Settings page)
// Two simple queries rather than one embedded join, to avoid depending on
// hand-maintained embedded-relation typings drifting out of sync with the
// actual Supabase-generated types.
// ---------------------------------------------------------------------------

export async function getEnabledToolsForAgent(
  supabase: SupabaseClient<Database>,
  agentId: string,
): Promise<Tool[]> {
  const { data: bindings, error: bindingsErr } = await supabase
    .from("agent_tools")
    .select("tool_id")
    .eq("agent_id", agentId)
    .eq("is_enabled", true);
  if (bindingsErr) {
    throw new Error(`Agent tool bindings lookup failed: ${bindingsErr.message}`);
  }
  const toolIds = (bindings ?? []).map((b) => b.tool_id);
  if (toolIds.length === 0) return [];

  const { data: toolRows, error: toolsErr } = await supabase
    .from("tools")
    .select("slug")
    .in("id", toolIds)
    .eq("is_enabled", true);
  if (toolsErr) {
    throw new Error(`Tool registry lookup failed: ${toolsErr.message}`);
  }
  const enabledSlugs = new Set((toolRows ?? []).map((t) => t.slug));

  return ALL_TOOLS.filter((t) => enabledSlugs.has(t.declaration.name));
}
