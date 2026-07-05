// Server-only Orchestrator core.
//
// Loads an agent from DB, pulls the user's Gemini key, calls the model,
// then persists a row in agent_runs. Kept intentionally small — this is the
// spine we'll extend with tool-calling, multi-step planning and other agent
// types (Architect, Developer, ...) in later iterations.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AgentRunResult } from "./runtime.functions";

const GEMINI_ENDPOINT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_SYSTEM_PROMPT = `You are J.A.R.V.I.S., a refined British-butler AI. Reply in the user's language. Be concise for chit-chat, thorough for substantive requests. Never break character.`;

export type OrchestratorInput = {
  supabase: SupabaseClient<Database>;
  userId: string;
  agentSlug: string;
  input: string;
  history: Array<{ role: "user" | "jarvis"; text: string }>;
};

export async function runOrchestrator(
  args: OrchestratorInput,
): Promise<AgentRunResult> {
  const { supabase, userId, agentSlug, input, history } = args;

  // 1. Resolve agent (fallback: orchestrator).
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id, name, model, config")
    .eq("owner_id", userId)
    .eq("slug", agentSlug)
    .maybeSingle();
  if (agentErr) throw new Error(`Agent lookup failed: ${agentErr.message}`);
  if (!agent) throw new Error(`Agent not found: ${agentSlug}`);

  // 2. Resolve Gemini API key from user_secrets.
  const { data: secret } = await supabase
    .from("user_secrets")
    .select("gemini_api_key")
    .eq("owner_id", userId)
    .maybeSingle();
  const apiKey = secret?.gemini_api_key?.trim();
  if (!apiKey) {
    throw new Error(
      "Brak klucza Gemini. Wpisz go w Settings → AI Core, aby uruchomić Agent Runtime.",
    );
  }

  const configObj = (agent.config ?? {}) as Record<string, unknown>;
  const systemPrompt =
    typeof configObj.system_prompt === "string" && configObj.system_prompt.trim()
      ? (configObj.system_prompt as string)
      : DEFAULT_SYSTEM_PROMPT;
  const model = agent.model?.trim() || "gemini-2.5-flash";

  // 3. Insert pending run row.
  const startedAt = Date.now();
  const { data: runRow, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      user_id: userId,
      agent_id: agent.id,
      status: "running",
      input: { text: input, history_len: history.length },
      started_at: new Date(startedAt).toISOString(),
    })
    .select("id")
    .single();
  if (runErr) throw new Error(`Run insert failed: ${runErr.message}`);
  const runId = runRow.id;

  // 4. Call Gemini (single-step, plain text out — no tool loop yet).
  try {
    const contents = [
      ...history
        .filter((h) => h.text && h.text.trim())
        .map((h) => ({
          role: h.role === "jarvis" ? ("model" as const) : ("user" as const),
          parts: [{ text: h.text }],
        })),
      { role: "user" as const, parts: [{ text: input }] },
    ];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(
      `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 1600,
          },
          contents,
        }),
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const msg = `Gemini HTTP ${res.status}: ${bodyText.slice(0, 300)}`;
      await supabase
        .from("agent_runs")
        .update({
          status: "error",
          error: msg,
          finished_at: new Date().toISOString(),
          latency_ms: Date.now() - startedAt,
        })
        .eq("id", runId);
      return { runId, status: "error", output: "", error: msg };
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";

    const tokensIn = data.usageMetadata?.promptTokenCount;
    const tokensOut = data.usageMetadata?.candidatesTokenCount;
    const latencyMs = Date.now() - startedAt;

    await supabase
      .from("agent_runs")
      .update({
        status: "done",
        output: { text },
        tokens_input: tokensIn ?? null,
        tokens_output: tokensOut ?? null,
        latency_ms: latencyMs,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      runId,
      status: "done",
      output: text,
      tokensIn,
      tokensOut,
      latencyMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("agent_runs")
      .update({
        status: "error",
        error: msg,
        finished_at: new Date().toISOString(),
        latency_ms: Date.now() - startedAt,
      })
      .eq("id", runId);
    return { runId, status: "error", output: "", error: msg };
  }
}