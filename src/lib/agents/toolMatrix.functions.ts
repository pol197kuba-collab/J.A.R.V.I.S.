// Dane zakładki NARZĘDZIA w Agent Hub: wszyscy agenci, katalog `tools`,
// włączone powiązania `agent_tools`, klasa ryzyka z kodu i użycie z 7 dni.
// Przełączanie idzie istniejącym `setAgentToolEnabled` (runtime.functions.ts).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FORCED_TOOLS_BY_SLUG } from "@/lib/constants/agentSlugs";
import { buildToolMatrix, type MatrixToolInput, type ToolMatrix } from "./toolMatrix";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Narzędzia budowane w kodzie, bez wiersza w `tools` (deklaracja dynamiczna). */
const CODE_ONLY_TOOLS: MatrixToolInput[] = [
  {
    id: null,
    slug: "delegate_to_agent",
    name: "Zespół: Deleguj zadanie",
    description: "Przekazuje część pracy innemu agentowi i czeka na jego odpowiedź.",
    globallyEnabled: true,
    risk: "write",
    untrusted: false,
  },
];

export const getToolMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ToolMatrix> => {
    const { supabase, userId } = context;
    // Rejestr narzędzi tylko na serwerze — nie może trafić do bundla klienta.
    const { ALL_TOOLS, bringsUntrustedContent, toolRisk } = await import("./tools.server");

    const [agentsRes, toolsRes] = await Promise.all([
      supabase
        .from("agents")
        .select("id, slug, name")
        .eq("owner_id", userId)
        .order("created_at", { ascending: true })
        .order("slug", { ascending: true }),
      supabase.from("tools").select("id, slug, name, description, is_enabled"),
    ]);
    if (agentsRes.error) throw new Error(agentsRes.error.message);
    if (toolsRes.error) throw new Error(toolsRes.error.message);
    const agents = agentsRes.data ?? [];

    const agentIds = agents.map((a) => a.id);
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const [bindingsRes, runsRes] = await Promise.all([
      agentIds.length
        ? supabase
            .from("agent_tools")
            .select("agent_id, tool_id")
            .in("agent_id", agentIds)
            .eq("is_enabled", true)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("agent_runs")
        .select("output")
        .eq("user_id", userId)
        .gte("created_at", since)
        .limit(2000),
    ]);
    if (bindingsRes.error) throw new Error(bindingsRes.error.message);

    const usage7d: Record<string, number> = {};
    for (const r of runsRes.data ?? []) {
      const calls = (r.output as { tool_calls?: Array<{ name?: unknown }> } | null)?.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const c of calls) {
        if (typeof c?.name === "string") usage7d[c.name] = (usage7d[c.name] ?? 0) + 1;
      }
    }

    const byName = new Map(ALL_TOOLS.map((t) => [t.declaration.name, t]));
    const tools: MatrixToolInput[] = (toolsRes.data ?? []).map((row) => {
      const code = byName.get(row.slug);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        globallyEnabled: row.is_enabled,
        risk: code ? toolRisk(code, {}) : null,
        untrusted: code ? bringsUntrustedContent(code, {}) : false,
      };
    });
    // Narzędzie z kodu, którego nie ma w katalogu (brak migracji) — widoczne, ale
    // zablokowane: model i tak go nie dostanie.
    const known = new Set(tools.map((t) => t.slug));
    for (const t of ALL_TOOLS) {
      const slug = t.declaration.name;
      if (known.has(slug)) continue;
      tools.push({
        id: null,
        slug,
        name: slug,
        description: "Jest w kodzie, ale nie w katalogu narzędzi w bazie — brakuje migracji.",
        globallyEnabled: false,
        risk: toolRisk(t, {}),
        untrusted: bringsUntrustedContent(t, {}),
      });
    }
    tools.push(...CODE_ONLY_TOOLS.filter((t) => !known.has(t.slug)));

    return buildToolMatrix({
      agents,
      tools,
      bindings: (bindingsRes.data ?? []).map((b) => ({ agentId: b.agent_id, toolId: b.tool_id })),
      forced: FORCED_TOOLS_BY_SLUG,
      usage7d,
    });
  });
