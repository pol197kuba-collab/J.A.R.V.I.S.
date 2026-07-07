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
  capabilities: unknown;
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
  input: unknown;
  output: unknown;
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
  meta: unknown;
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
