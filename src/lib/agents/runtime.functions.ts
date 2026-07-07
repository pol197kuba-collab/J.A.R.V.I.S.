// Agent Runtime — server-side functions.
//
// Zgodnie z CODEX.md: to jest fundament pod Orchestratora. Na tym etapie
// obsługujemy jednego agenta ("orchestrator") i pojedynczy krok wywołania
// LLM (bez multi-step tool loopu). Pamięć krótkoterminowa przekazywana jest
// w polu `history`, żeby nie budować jeszcze konwersacji w DB.
//
// Wszystkie funkcje są chronione przez requireSupabaseAuth — klucz Gemini
// nigdy nie opuszcza serwera.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Types shared with the client
// ---------------------------------------------------------------------------

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  description: string | null;
  model: string | null;
  status: string;
  isEnabled: boolean;
  activeRuns: number;
  lastRunAt: string | null;
};

export type AgentRunResult = {
  runId: string;
  status: "done" | "error";
  output: string;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
};

// ---------------------------------------------------------------------------
// Agent detail (agent console page)
// ---------------------------------------------------------------------------

export type AgentBehaviourConfig = {
  systemPromptOverride: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  maxToolIterations: number | null;
  voiceLanguage: "auto" | "en" | "pl" | null;
  voiceEnabled: boolean | null;
};

export type AgentRecord = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  description: string | null;
  model: string | null;
  status: string;
  isEnabled: boolean;
  capabilities: Json;
  behaviour: AgentBehaviourConfig;
  createdAt: string;
  updatedAt: string;
};

export type AgentStats = {
  runsTotal: number;
  runs24h: number;
  runs7d: number;
  runsErr24h: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  tokensInTotal: number;
  tokensOutTotal: number;
  tokensIn24h: number;
  tokensOut24h: number;
  sparkline: number[]; // 24 buckets, runs per hour, oldest → newest
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

export type AgentRunRecord = {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  input: Json;
  output: Json;
};

export type AgentConversationSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
};

export type AgentEventRecord = {
  id: string;
  createdAt: string;
  level: string;
  source: string;
  message: string;
  meta: Json;
  origin: "system_events" | "event_log";
};

export type AgentDetail = {
  agent: AgentRecord;
  effectiveModel: string;
  stats: AgentStats;
  activeRuns: AgentRunRecord[];
  recentRuns: AgentRunRecord[];
  toolUsage24h: Record<string, number>;
  toolUsage7d: Record<string, number>;
  tools: AgentToolSummary[];
  conversationsCount: number;
  recentConversations: AgentConversationSummary[];
  memoriesByKind: Record<string, number>;
  events: AgentEventRecord[];
};

// ---------------------------------------------------------------------------
// user_secrets (Gemini API key)
// ---------------------------------------------------------------------------

export const getGeminiKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const key = data?.gemini_api_key?.trim() ?? "";
    return {
      linked: key.length > 0,
      // Never return the raw value. Just a masked preview so the UI can hint.
      preview: key ? `••••••••${key.slice(-4)}` : null,
    };
  });

const SaveKeyInput = z.object({ key: z.string().min(1).max(512) });

export const saveGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveKeyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_secrets")
      .upsert({ owner_id: userId, gemini_api_key: data.key.trim() }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_secrets").delete().eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// user_settings
// ---------------------------------------------------------------------------

export type UserSettings = {
  chatRouting: "client" | "server";
  defaultModel: string;
  voiceLanguage: "auto" | "en" | "pl";
  wakeWordEnabled: boolean;
};

const DEFAULT_SETTINGS: UserSettings = {
  chatRouting: "client",
  defaultModel: "gemini-2.5-flash",
  voiceLanguage: "auto",
  wakeWordEnabled: true,
};

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserSettings> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_settings")
      .select("chat_routing, default_model, voice_language, wake_word_enabled")
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return DEFAULT_SETTINGS;
    return {
      chatRouting: data.chat_routing as "client" | "server",
      defaultModel: data.default_model,
      voiceLanguage: data.voice_language as "auto" | "en" | "pl",
      wakeWordEnabled: data.wake_word_enabled,
    };
  });

const UpdateSettingsInput = z
  .object({
    chatRouting: z.enum(["client", "server"]).optional(),
    defaultModel: z.enum(["gemini-2.5-flash", "gemini-2.5-pro"]).optional(),
    voiceLanguage: z.enum(["auto", "en", "pl"]).optional(),
    wakeWordEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSettingsInput.parse(input))
  .handler(async ({ data, context }): Promise<UserSettings> => {
    const { supabase, userId } = context;
    const patch: {
      owner_id: string;
      chat_routing?: "client" | "server";
      default_model?: string;
      voice_language?: "auto" | "en" | "pl";
      wake_word_enabled?: boolean;
    } = { owner_id: userId };
    if (data.chatRouting !== undefined) patch.chat_routing = data.chatRouting;
    if (data.defaultModel !== undefined) patch.default_model = data.defaultModel;
    if (data.voiceLanguage !== undefined) patch.voice_language = data.voiceLanguage;
    if (data.wakeWordEnabled !== undefined) patch.wake_word_enabled = data.wakeWordEnabled;
    const { data: row, error } = await supabase
      .from("user_settings")
      .upsert(patch, { onConflict: "owner_id" })
      .select("chat_routing, default_model, voice_language, wake_word_enabled")
      .single();
    if (error) throw new Error(error.message);
    return {
      chatRouting: row.chat_routing as "client" | "server",
      defaultModel: row.default_model,
      voiceLanguage: row.voice_language as "auto" | "en" | "pl",
      wakeWordEnabled: row.wake_word_enabled,
    };
  });

// ---------------------------------------------------------------------------
// Agent tools (registry visibility + per-agent enable toggle)
// ---------------------------------------------------------------------------

export type AgentToolSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  globallyEnabled: boolean;
  enabledForAgent: boolean;
};

const AgentSlugInput = z.object({
  agentSlug: z.string().min(1).max(64).default("orchestrator"),
});

export const listAgentTools = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AgentSlugInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AgentToolSummary[]> => {
    const { supabase, userId } = context;

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id")
      .eq("owner_id", userId)
      .eq("slug", data.agentSlug)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agent) return [];

    const { data: tools, error: toolsErr } = await supabase
      .from("tools")
      .select("id, slug, name, description, is_enabled")
      .order("name", { ascending: true });
    if (toolsErr) throw new Error(toolsErr.message);

    const { data: bindings, error: bindingsErr } = await supabase
      .from("agent_tools")
      .select("tool_id, is_enabled")
      .eq("agent_id", agent.id);
    if (bindingsErr) throw new Error(bindingsErr.message);

    const bindingByTool = new Map((bindings ?? []).map((b) => [b.tool_id, b.is_enabled]));

    return (tools ?? []).map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      globallyEnabled: t.is_enabled,
      enabledForAgent: bindingByTool.get(t.id) ?? false,
    }));
  });

const SetAgentToolInput = z.object({
  agentSlug: z.string().min(1).max(64).default("orchestrator"),
  toolId: z.string().uuid(),
  enabled: z.boolean(),
});

export const setAgentToolEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetAgentToolInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id")
      .eq("owner_id", userId)
      .eq("slug", data.agentSlug)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agent) throw new Error(`Agent not found: ${data.agentSlug}`);

    const { error } = await supabase
      .from("agent_tools")
      .upsert(
        { agent_id: agent.id, tool_id: data.toolId, is_enabled: data.enabled },
        { onConflict: "agent_id,tool_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgentSummary[]> => {
    const { supabase, userId } = context;
    const { data: agents, error } = await supabase
      .from("agents")
      .select("id, slug, name, role, description, model, status, is_enabled")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    if (!agents || agents.length === 0) return [];

    const { data: runs } = await supabase
      .from("agent_runs")
      .select("agent_id, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);

    return agents.map((a) => {
      const agentRuns = (runs ?? []).filter((r) => r.agent_id === a.id);
      const activeRuns = agentRuns.filter(
        (r) => r.status === "running" || r.status === "pending",
      ).length;
      const last = agentRuns[0];
      return {
        id: a.id,
        slug: a.slug,
        name: a.name,
        role: a.role,
        description: a.description,
        model: a.model,
        status: a.status,
        isEnabled: a.is_enabled,
        activeRuns,
        lastRunAt: last?.created_at ?? null,
      };
    });
  });

// ---------------------------------------------------------------------------
// runAgent — the main entry point
// ---------------------------------------------------------------------------

const RunAgentInput = z.object({
  agentSlug: z.string().min(1).max(64).default("orchestrator"),
  input: z.string().min(1).max(8000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "jarvis"]),
        text: z.string().min(1).max(8000),
      }),
    )
    .max(30)
    .optional(),
});

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunAgentInput.parse(input))
  .handler(async ({ data, context }): Promise<AgentRunResult> => {
    const { supabase, userId } = context;

    const { runOrchestrator } = await import("./runtime.server");
    return runOrchestrator({
      supabase,
      userId,
      agentSlug: data.agentSlug,
      input: data.input,
      history: data.history ?? [],
    });
  });

// ---------------------------------------------------------------------------
// Agent detail RPC
// ---------------------------------------------------------------------------

function parseBehaviour(config: unknown): AgentBehaviourConfig {
  const c = (config ?? {}) as Record<string, unknown>;
  const voice = (c.voice ?? {}) as Record<string, unknown>;
  const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const asStr = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const lang = asStr(voice.language);
  return {
    systemPromptOverride: asStr(c.system_prompt),
    temperature: asNum(c.temperature),
    maxOutputTokens: asNum(c.max_output_tokens),
    maxToolIterations: asNum(c.max_tool_iterations),
    voiceLanguage:
      lang === "auto" || lang === "en" || lang === "pl" ? (lang as "auto" | "en" | "pl") : null,
    voiceEnabled: typeof voice.enabled === "boolean" ? (voice.enabled as boolean) : null,
  };
}

const AgentDetailInput = z.object({ slug: z.string().min(1).max(64) });

export const getAgentDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AgentDetailInput.parse(input))
  .handler(async ({ data, context }): Promise<AgentDetail> => {
    const { supabase, userId } = context;

    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select(
        "id, slug, name, role, description, model, status, is_enabled, capabilities, config, created_at, updated_at",
      )
      .eq("owner_id", userId)
      .eq("slug", data.slug)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agentRow) throw new Error(`Agent not found: ${data.slug}`);

    const agent: AgentRecord = {
      id: agentRow.id,
      slug: agentRow.slug,
      name: agentRow.name,
      role: agentRow.role,
      description: agentRow.description,
      model: agentRow.model,
      status: agentRow.status,
      isEnabled: agentRow.is_enabled,
      capabilities: agentRow.capabilities,
      behaviour: parseBehaviour(agentRow.config),
      createdAt: agentRow.created_at,
      updatedAt: agentRow.updated_at,
    };

    // Resolve effective model (agent override → user default → hardcoded).
    let effectiveModel = agent.model?.trim() ?? "";
    if (!effectiveModel) {
      const { data: prefs } = await supabase
        .from("user_settings")
        .select("default_model")
        .eq("owner_id", userId)
        .maybeSingle();
      effectiveModel = prefs?.default_model?.trim() || "gemini-2.5-flash";
    }

    // Runs — pull the last 500 for stats + slicing.
    const { data: runsAll } = await supabase
      .from("agent_runs")
      .select(
        "id, status, created_at, started_at, finished_at, latency_ms, tokens_input, tokens_output, error, input, output",
      )
      .eq("user_id", userId)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(500);

    const runs = runsAll ?? [];
    const now = Date.now();
    const H24 = now - 24 * 3600_000;
    const D7 = now - 7 * 24 * 3600_000;

    const ts = (r: (typeof runs)[number]) => new Date(r.created_at).getTime();
    const inWindow = (r: (typeof runs)[number], from: number) => ts(r) >= from;

    const doneRuns = runs.filter((r) => r.status === "done");
    const errorRuns = runs.filter((r) => r.status === "error");
    const runs24h = runs.filter((r) => inWindow(r, H24));
    const runs7d = runs.filter((r) => inWindow(r, D7));
    const errors24h = runs24h.filter((r) => r.status === "error").length;

    const latencies = doneRuns
      .map((r) => r.latency_ms)
      .filter((v): v is number => typeof v === "number" && v >= 0)
      .sort((a, b) => a - b);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;
    const p95Latency =
      latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;

    const sumTokens = (list: typeof runs, key: "tokens_input" | "tokens_output") =>
      list.reduce((sum, r) => sum + ((r[key] as number | null) ?? 0), 0);

    // Sparkline: last 24 hours, one bucket per hour.
    const sparkline = Array<number>(24).fill(0);
    for (const r of runs24h) {
      const hoursAgo = Math.floor((now - ts(r)) / 3600_000);
      const idx = 23 - Math.min(23, Math.max(0, hoursAgo));
      sparkline[idx] += 1;
    }

    const closedCount = doneRuns.length + errorRuns.length;
    const stats: AgentStats = {
      runsTotal: runs.length,
      runs24h: runs24h.length,
      runs7d: runs7d.length,
      runsErr24h: errors24h,
      successRate: closedCount > 0 ? doneRuns.length / closedCount : null,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      tokensInTotal: sumTokens(runs, "tokens_input"),
      tokensOutTotal: sumTokens(runs, "tokens_output"),
      tokensIn24h: sumTokens(runs24h, "tokens_input"),
      tokensOut24h: sumTokens(runs24h, "tokens_output"),
      sparkline,
      lastRunAt: runs[0]?.created_at ?? null,
      lastRunStatus: runs[0]?.status ?? null,
    };

    const toRunRecord = (r: (typeof runs)[number]): AgentRunRecord => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      latencyMs: r.latency_ms,
      tokensIn: r.tokens_input,
      tokensOut: r.tokens_output,
      error: r.error,
      input: r.input,
      output: r.output,
    });

    const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending").map(toRunRecord);
    const recentRuns = runs.slice(0, 20).map(toRunRecord);

    // Tool usage aggregates — parsed from output.tool_calls in agent_runs.
    const usage24h: Record<string, number> = {};
    const usage7d: Record<string, number> = {};
    for (const r of runs7d) {
      const out = (r.output ?? {}) as { tool_calls?: Array<{ name?: string }> };
      const calls = Array.isArray(out.tool_calls) ? out.tool_calls : [];
      for (const c of calls) {
        const name = typeof c?.name === "string" ? c.name : null;
        if (!name) continue;
        usage7d[name] = (usage7d[name] ?? 0) + 1;
        if (inWindow(r, H24)) usage24h[name] = (usage24h[name] ?? 0) + 1;
      }
    }

    // Tools — reuse the query used by listAgentTools.
    const { data: toolRows } = await supabase
      .from("tools")
      .select("id, slug, name, description, is_enabled")
      .order("name", { ascending: true });
    const { data: bindings } = await supabase
      .from("agent_tools")
      .select("tool_id, is_enabled")
      .eq("agent_id", agent.id);
    const bindingByTool = new Map((bindings ?? []).map((b) => [b.tool_id, b.is_enabled]));
    const tools: AgentToolSummary[] = (toolRows ?? []).map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      globallyEnabled: t.is_enabled,
      enabledForAgent: bindingByTool.get(t.id) ?? false,
    }));

    // Conversations.
    const { count: conversationsCount } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("agent_id", agent.id);

    const { data: recentConvRows } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .eq("agent_id", agent.id)
      .order("updated_at", { ascending: false })
      .limit(3);
    const recentConversations: AgentConversationSummary[] = (recentConvRows ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updated_at,
    }));

    // Memories per kind.
    const { data: memRows } = await supabase
      .from("memories")
      .select("kind")
      .eq("user_id", userId)
      .eq("agent_id", agent.id);
    const memoriesByKind: Record<string, number> = {};
    for (const m of memRows ?? []) {
      const k = (m.kind as string) || "note";
      memoriesByKind[k] = (memoriesByKind[k] ?? 0) + 1;
    }

    // Events — system_events (source = slug or 'orchestrator' or 'tool.*') + event_log for this agent.
    const { data: sysEvents } = await supabase
      .from("system_events")
      .select("id, level, source, message, meta, created_at")
      .eq("owner_id", userId)
      .or(`source.eq.${agent.slug},source.like.tool.%,source.eq.orchestrator`)
      .order("created_at", { ascending: false })
      .limit(40);
    const { data: logEvents } = await supabase
      .from("event_log")
      .select("id, level, source, message, metadata, created_at")
      .eq("user_id", userId)
      .eq("source", agent.slug)
      .order("created_at", { ascending: false })
      .limit(20);

    const events: AgentEventRecord[] = [
      ...(sysEvents ?? []).map<AgentEventRecord>((e) => ({
        id: e.id,
        createdAt: e.created_at,
        level: e.level,
        source: e.source,
        message: e.message,
        meta: e.meta,
        origin: "system_events" as const,
      })),
      ...(logEvents ?? []).map<AgentEventRecord>((e) => ({
        id: e.id,
        createdAt: e.created_at,
        level: e.level,
        source: e.source,
        message: e.message,
        meta: e.metadata,
        origin: "event_log" as const,
      })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 40);

    return {
      agent,
      effectiveModel,
      stats,
      activeRuns,
      recentRuns,
      toolUsage24h: usage24h,
      toolUsage7d: usage7d,
      tools,
      conversationsCount: conversationsCount ?? 0,
      recentConversations,
      memoriesByKind,
      events,
    };
  });

// ---------------------------------------------------------------------------
// updateAgentSettings — patch identity, model & behaviour config
// ---------------------------------------------------------------------------

const UpdateAgentSettingsInput = z.object({
  slug: z.string().min(1).max(64),
  patch: z
    .object({
      name: z.string().min(1).max(80).optional(),
      role: z.string().max(120).nullable().optional(),
      description: z.string().max(1200).nullable().optional(),
      model: z.enum(["gemini-2.5-flash", "gemini-2.5-pro"]).nullable().optional(),
      isEnabled: z.boolean().optional(),
      behaviour: z
        .object({
          systemPromptOverride: z.string().max(4000).nullable().optional(),
          temperature: z.number().min(0).max(1).nullable().optional(),
          maxOutputTokens: z.number().int().min(64).max(8192).nullable().optional(),
          maxToolIterations: z.number().int().min(1).max(12).nullable().optional(),
          voiceLanguage: z.enum(["auto", "en", "pl"]).nullable().optional(),
          voiceEnabled: z.boolean().nullable().optional(),
        })
        .optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "empty patch"),
});

export const updateAgentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateAgentSettingsInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("id, config")
      .eq("owner_id", userId)
      .eq("slug", data.slug)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agentRow) throw new Error(`Agent not found: ${data.slug}`);

    const patch: Record<string, unknown> = {};
    if (data.patch.name !== undefined) patch.name = data.patch.name;
    if (data.patch.role !== undefined) patch.role = data.patch.role;
    if (data.patch.description !== undefined) patch.description = data.patch.description;
    if (data.patch.model !== undefined) patch.model = data.patch.model; // null = inherit
    if (data.patch.isEnabled !== undefined) patch.is_enabled = data.patch.isEnabled;

    if (data.patch.behaviour) {
      const current = ((agentRow.config ?? {}) as Record<string, unknown>) || {};
      const currentVoice = ((current.voice ?? {}) as Record<string, unknown>) || {};
      const b = data.patch.behaviour;
      const nextConfig: Record<string, unknown> = { ...current };
      if (b.systemPromptOverride !== undefined) nextConfig.system_prompt = b.systemPromptOverride ?? null;
      if (b.temperature !== undefined) nextConfig.temperature = b.temperature;
      if (b.maxOutputTokens !== undefined) nextConfig.max_output_tokens = b.maxOutputTokens;
      if (b.maxToolIterations !== undefined) nextConfig.max_tool_iterations = b.maxToolIterations;
      if (b.voiceLanguage !== undefined || b.voiceEnabled !== undefined) {
        const nextVoice: Record<string, unknown> = { ...currentVoice };
        if (b.voiceLanguage !== undefined) nextVoice.language = b.voiceLanguage;
        if (b.voiceEnabled !== undefined) nextVoice.enabled = b.voiceEnabled;
        nextConfig.voice = nextVoice;
      }
      patch.config = nextConfig;
    }

    const { error } = await supabase
      .from("agents")
      .update(patch as never)
      .eq("id", agentRow.id);
    if (error) throw new Error(error.message);

    await supabase.from("system_events").insert({
      owner_id: userId,
      level: "info",
      source: data.slug,
      message: `agent settings updated (${Object.keys(patch).join(", ")})`,
      meta: {} as Json,
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// resetAgentStats / clearAgentConversations
// ---------------------------------------------------------------------------

const AgentSlugOnly = z.object({ slug: z.string().min(1).max(64) });

export const resetAgentStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AgentSlugOnly.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await supabase.from("system_events").insert({
      owner_id: userId,
      level: "warn",
      source: data.slug,
      message: "stats reset marker (historical runs preserved)",
      meta: { reset_at: new Date().toISOString() } as Json,
    });
    return { ok: true };
  });

export const clearAgentConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AgentSlugOnly.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; deleted: number }> => {
    const { supabase, userId } = context;
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("id")
      .eq("owner_id", userId)
      .eq("slug", data.slug)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agentRow) throw new Error(`Agent not found: ${data.slug}`);

    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("agent_id", agentRow.id);
    const ids = (convs ?? []).map((c) => c.id);
    if (ids.length === 0) return { ok: true, deleted: 0 };

    const { error: delErr } = await supabase.from("conversations").delete().in("id", ids);
    if (delErr) throw new Error(delErr.message);

    await supabase.from("system_events").insert({
      owner_id: userId,
      level: "warn",
      source: data.slug,
      message: `cleared ${ids.length} conversation(s)`,
      meta: {} as Json,
    });
    return { ok: true, deleted: ids.length };
  });
