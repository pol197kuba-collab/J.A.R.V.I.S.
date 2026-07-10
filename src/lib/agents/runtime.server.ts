// Server-only Orchestrator core.
//
// Loads an agent from DB, pulls the user's Gemini key, calls the model,
// then persists a row in agent_runs. Kept intentionally small — this is the
// spine we'll extend with tool-calling, multi-step planning and other agent
// types (Architect, Developer, ...) in later iterations.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { AgentRunResult } from "./runtime.functions";
import { getEnabledToolsForAgent, getToolByName } from "./tools.server";
import { JARVIS_PERSONA } from "@/lib/ai/persona";
import { DEFAULT_GEMINI_MODEL } from "./models";

// UI actions the Orchestrator (or any agent facing the user directly) can
// trigger via the perform_ui_action tool. Must stay in sync with the
// JarvisAction union in src/lib/ai/jarvisBrain.ts — single vocabulary shared
// by voice, chat and the old client-side fallback path.
const UI_ACTIONS = [
  "open_dashboard", "open_fuel", "open_calculator", "open_jobfit", "open_telemetry",
  "open_menu", "close_menu", "system_check", "sleep", "shutdown", "reboot",
  "open_agents", "open_settings", "open_logs", "open_subsystems",
] as const;
type UiAction = (typeof UI_ACTIONS)[number];
const UI_ACTION_TOOL_NAME = "perform_ui_action";
// Same vocabulary plus an explicit escape hatch — used only by the forced
// classifier fallback below, where the model MUST pick something and needs
// a legitimate way to say "this message isn't a UI action at all".
const UI_ACTIONS_WITH_NONE = [...UI_ACTIONS, "none"] as const;

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_SYSTEM_PROMPT = `${JARVIS_PERSONA}

Be concise for chit-chat, thorough for substantive requests.

TOOL USE:
You may have zero or more tools available, described in this request's function
declarations — the exact set depends on what the user has enabled for you in
Settings, so never assume a specific tool exists; check the declarations you
actually received. When a tool is available and fits the request, use it
proactively rather than guessing or refusing:
- For factual / current-event / research questions, prefer a search-style tool
  over answering from memory. Use SHORT keyword queries (2-4 words), not full
  sentences. If a search returns 0 results, retry once with simpler keywords.
- To read a specific page in detail, search first, then fetch the best URL.
- When the user asks you to remember, save, or note something (e.g. "zapisz
  notatkę", "save this"), use a note-saving tool if one is available. Also use
  it when you have produced a substantive summary/list/plan the user should
  keep — but do not save trivial chit-chat.
- If no tool fits or none are available, answer directly from your own
  knowledge instead of mentioning that a tool is missing.
- After tool calls, produce a final natural-language answer in character. Do
  not describe the tools you used unless asked.
`;

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_TEMPERATURE = 0.85;
const DEFAULT_MAX_OUTPUT_TOKENS = 1600;

export type OrchestratorInput = {
  supabase: SupabaseClient<Database>;
  userId: string;
  agentSlug: string;
  input: string;
  history: Array<{ role: "user" | "jarvis"; text: string }>;
  /** Prevents delegate_to_agent recursion loops. */
  delegationDepth?: number;
  /** Existing conversation to append to. Omit to start a new one. */
  conversationId?: string | null;
};

export async function runOrchestrator(args: OrchestratorInput): Promise<AgentRunResult> {
  const {
    supabase,
    userId,
    agentSlug,
    input,
    history,
    delegationDepth = 0,
    conversationId: incomingConversationId = null,
  } = args;

  // 1. Resolve agent (fallback: orchestrator).
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id, name, slug, model, config")
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
    throw new Error("Brak klucza Gemini. Wpisz go w Settings → AI Core, aby uruchomić Agent Runtime.");
  }

  const configObj: Record<string, unknown> =
    agent.config && typeof agent.config === "object" && !Array.isArray(agent.config)
      ? (agent.config as Record<string, unknown>)
      : {};

  const agentSpecific =
    typeof configObj.system_prompt === "string" && configObj.system_prompt.trim() ? configObj.system_prompt : null;

  // Team roster — every agent should know who else is on the payroll so the
  // Orchestrator can delegate and any agent can name-drop a teammate instead
  // of denying they exist.
  const { data: roster } = await supabase
    .from("agents")
    .select("slug, name, role, description, is_enabled")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  const teammates = (roster ?? []).filter((r) => r.slug !== agent.slug);
  const rosterBlock =
    teammates.length > 0
      ? `\n\nTEAM ROSTER — inne agenty w systemie (nie odmawiaj ich istnienia):\n` +
        teammates
          .map(
            (t) =>
              `- ${t.name} (slug: ${t.slug})${t.role ? ` — ${t.role}` : ""}${
                t.is_enabled ? "" : " [DISABLED]"
              }${t.description ? `. ${t.description}` : ""}`,
          )
          .join("\n") +
        (agent.slug === "orchestrator"
          ? `\n\nJako Orchestrator MOŻESZ delegować zadanie do wybranego kolegi używając narzędzia delegate_to_agent(slug, task). Rób to, kiedy zadanie pasuje wyraźnie do specjalizacji innego agenta (np. copy / marketing → marketer). Zwracaj użytkownikowi krótkie streszczenie odpowiedzi delegowanego agenta w swoim głosie.`
          : "")
      : "";

  const basePrompt = agentSpecific ? `${JARVIS_PERSONA}\n\n${agentSpecific}` : DEFAULT_SYSTEM_PROMPT;

  // Always appended, regardless of whether the agent has a custom
  // system_prompt override — otherwise agents like Marketer never learn
  // they have this capability at all. Explicitly forbids the "I don't have
  // UI access" refusal pattern, which is a strong default behaviour in base
  // model training and tends to override a merely-declared tool otherwise.
  const uiActionInstructions = `\n\nDOSTĘP DO INTERFEJSU: Masz REALNĄ możliwość sterowania interfejsem JARVIS HUD poprzez narzędzie ${UI_ACTION_TOOL_NAME}. Gdy użytkownik prosi o otwarcie, zamknięcie, przełączenie widoku, restart, uśpienie lub wyłączenie systemu — NIGDY nie odmawiaj i NIE twierdź, że nie masz dostępu do interfejsu. Zawsze wywołaj ${UI_ACTION_TOOL_NAME} z właściwą wartością "action", nawet jeśli polecenie jest sformułowane luźno lub pośrednio (np. "przełącz mnie na X", "pokaż mi Y", "zamknij to", "wróć do głównego ekranu"). Dopiero gdy żadna z dostępnych akcji faktycznie nie pasuje do prośby, wyjaśnij czego brakuje — nigdy nie zgaduj, że nie masz takiej mocy.`;

  const systemPrompt = `${basePrompt}${rosterBlock}${uiActionInstructions}`;

  // Model resolution: agent override → user default → hardcoded fallback.
  let model = agent.model?.trim() ?? "";
  if (!model) {
    const { data: prefs } = await supabase
      .from("user_settings")
      .select("default_model")
      .eq("owner_id", userId)
      .maybeSingle();
    model = prefs?.default_model?.trim() || DEFAULT_GEMINI_MODEL;
  }

  const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const temperature = clampNum(configObj.temperature, 0, 1, DEFAULT_TEMPERATURE);
  const maxOutputTokens = clampNum(configObj.max_output_tokens, 64, 8192, DEFAULT_MAX_OUTPUT_TOKENS);
  const maxToolIterations = Math.round(clampNum(configObj.max_tool_iterations, 1, 12, DEFAULT_MAX_TOOL_ITERATIONS));

  // Conversation this turn belongs to. Only top-level calls own a
  // conversation row — delegated sub-runs (delegationDepth > 0) piggyback
  // on the parent's agent_run and don't need their own thread.
  let resolvedConversationId: string | null = null;
  if (delegationDepth === 0) {
    if (incomingConversationId) {
      resolvedConversationId = incomingConversationId;
    } else {
      const { data: convRow, error: convErr } = await supabase
        .from("conversations")
        .insert({ user_id: userId, agent_id: agent.id, title: input.slice(0, 60) })
        .select("id")
        .single();
      if (convErr) throw new Error(`Conversation insert failed: ${convErr.message}`);
      resolvedConversationId = convRow.id;
    }
  }

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

  // logEvent helper — writes to system_events so the System Logs page shows real telemetry.
  const logEvent = async (level: "info" | "warn" | "error", source: string, message: string, meta?: Json) => {
    await supabase.from("system_events").insert({
      owner_id: userId,
      level,
      source,
      message,
      meta: (meta ?? {}) as Json,
    });
  };

  await logEvent("info", "orchestrator", `run started · model ${model}`, {
    run_id: runId,
    agent: agentSlug,
    input_preview: input.slice(0, 120),
  } as Json);

  // 4. Call Gemini with function-calling loop.
  try {
    type GeminiPart =
      | { text: string }
      | { functionCall: { name: string; args: Record<string, unknown> } }
      | {
          functionResponse: {
            name: string;
            response: Record<string, unknown>;
          };
        };
    type GeminiContent = { role: "user" | "model" | "function"; parts: GeminiPart[] };

    const contents: GeminiContent[] = [
      ...history
        .filter((h) => h.text && h.text.trim())
        .map<GeminiContent>((h) => ({
          role: h.role === "jarvis" ? "model" : "user",
          parts: [{ text: h.text }],
        })),
      { role: "user", parts: [{ text: input }] },
    ];

    // Tool registry is DB-driven: public.tools (global catalog + kill switch)
    // joined through public.agent_tools (per-agent binding + enable toggle).
    // Implementations still live in code (tools.server.ts) — the DB only
    // decides which of the known tools this particular agent may call right
    // now, so a Settings-page toggle takes effect without a redeploy.
    const enabledTools = await getEnabledToolsForAgent(supabase, agent.id);
    const toolDeclarations = enabledTools.map((t) => t.declaration);

    // UI action tool — available to any agent that might face the user
    // directly in chat/voice (not gated behind delegation), so switching the
    // active agent in ChatPanel doesn't lose navigation ability.
    toolDeclarations.push({
      name: UI_ACTION_TOOL_NAME,
      description:
        "Wykonaj akcję w interfejsie JARVIS HUD (nawigacja między ekranami, tryb systemowy). Użyj, gdy użytkownik prosi o otwarcie/zamknięcie czegoś w aplikacji lub zmianę stanu systemu — dopasuj po ZNACZENIU polecenia, niezależnie od dokładnych słów użytkownika.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: UI_ACTIONS as unknown as string[],
            description: "Konkretna akcja do wykonania w interfejsie.",
          },
        },
        required: ["action"],
      },
    });

    // Orchestrator always gets an in-memory delegate tool, even without a DB
    // row, so it can hand off to teammates without a migration. Guard against
    // recursion depth so a chain of delegations can't loop forever.
    const DELEGATE_TOOL_NAME = "delegate_to_agent";
    const allowDelegate =
      agent.slug === "orchestrator" && teammates.length > 0 && delegationDepth < 2;
    if (allowDelegate) {
      toolDeclarations.push({
        name: DELEGATE_TOOL_NAME,
        description:
          "Deleguj zadanie do innego agenta z zespołu (np. marketer, copywriter). Zwraca jego odpowiedź jako tekst.",
        parameters: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: `Slug docelowego agenta. Dozwolone: ${teammates
                .map((t) => t.slug)
                .join(", ")}.`,
            },
            task: {
              type: "string",
              description: "Pełne polecenie/zadanie dla delegowanego agenta w jego języku.",
            },
          },
          required: ["slug", "task"],
        },
      });
    }
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let finalText = "";
    let uiAction: UiAction | null = null;
    const toolCallLog: Array<{ name: string; args: Record<string, unknown> }> = [];

    for (let iter = 0; iter < maxToolIterations; iter++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(
        `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { temperature, maxOutputTokens },
            // Gemini rejects an empty functionDeclarations array, and an
            // agent may legitimately have zero tools enabled (all toggled
            // off in Settings) — omit the `tools` key entirely in that case.
            ...(toolDeclarations.length > 0 ? { tools: [{ functionDeclarations: toolDeclarations }] } : {}),
            contents,
          }),
        },
      );
      clearTimeout(timer);

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { role?: string; parts?: GeminiPart[] } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
      totalTokensIn += data.usageMetadata?.promptTokenCount ?? 0;
      totalTokensOut += data.usageMetadata?.candidatesTokenCount ?? 0;

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const functionCalls = parts.flatMap((p) => ("functionCall" in p && p.functionCall ? [p.functionCall] : []));
      const textOut = parts
        .flatMap((p) => ("text" in p && p.text ? [p.text] : []))
        .join("")
        .trim();

      if (functionCalls.length === 0) {
        finalText = textOut;
        break;
      }

      // Append model turn (function calls) to the running contents.
      contents.push({
        role: "model",
        parts: functionCalls.map((fc) => ({
          functionCall: { name: fc.name, args: fc.args ?? {} },
        })),
      });

      // Execute each tool and append function responses.
      const responseParts: GeminiPart[] = [];
      for (const call of functionCalls) {
        toolCallLog.push({ name: call.name, args: call.args ?? {} });
        const tool = getToolByName(call.name);
        let response: Record<string, unknown>;
        if (call.name === UI_ACTION_TOOL_NAME) {
          const requested = String((call.args as Record<string, unknown>)?.action ?? "");
          if ((UI_ACTIONS as readonly string[]).includes(requested)) {
            uiAction = requested as UiAction;
            response = { ok: true, action: requested };
            await logEvent("info", "orchestrator", `ui action: ${requested}`, { run_id: runId } as Json);
          } else {
            response = { error: "invalid_action", requested };
          }
        } else if (call.name === DELEGATE_TOOL_NAME && allowDelegate) {
          const targetSlug = String((call.args as Record<string, unknown>)?.slug ?? "").trim();
          const task = String((call.args as Record<string, unknown>)?.task ?? "").trim();
          const target = teammates.find((t) => t.slug === targetSlug && t.is_enabled);
          if (!target || !task) {
            response = { error: `invalid_delegation`, requested: targetSlug };
            await logEvent("warn", "orchestrator", `delegate rejected: ${targetSlug}`, {
              run_id: runId,
            } as Json);
          } else {
            await logEvent("info", "orchestrator", `delegating → ${targetSlug}`, {
              run_id: runId,
              task_preview: task.slice(0, 200),
            } as Json);
            const sub = await runOrchestrator({
              supabase,
              userId,
              agentSlug: target.slug,
              input: task,
              history: [],
              delegationDepth: delegationDepth + 1,
            });
            response = {
              delegate: target.slug,
              status: sub.status,
              output: sub.output,
              error: sub.error,
            };
          }
        } else if (!tool) {
          response = { error: `unknown_tool_${call.name}` };
          await logEvent("warn", "orchestrator", `unknown tool call: ${call.name}`, {
            run_id: runId,
          } as Json);
        } else {
          try {
            response = await tool.execute(call.args ?? {}, {
              supabase,
              userId,
              runId,
              apiKey,
              model,
              logEvent,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            response = { error: msg };
            await logEvent("error", `tool.${call.name}`, msg, { run_id: runId } as Json);
          }
        }
        responseParts.push({
          functionResponse: { name: call.name, response },
        });
      }
      contents.push({ role: "function", parts: responseParts });

      if (iter === maxToolIterations - 1) {
        // Force a final text reply on the next (skipped) turn by breaking here
        // but we already broke out via loop bound. If we get here we still
        // have unconsumed tool output; fall through to a graceful message.
        finalText =
          "I have completed several tool calls but ran out of orchestration cycles. Please rephrase or ask me to continue.";
      }
    }

    // Fallback classifier pass. Base models tend to have a strong learned
    // habit of claiming "I can't control the UI" even when a real tool is
    // declared and instructed — this shows up especially on loosely phrased
    // requests. If the main AUTO-mode turn above never called
    // perform_ui_action, force one more narrow decision: restrict the model
    // to ONLY that tool (tool_config mode "ANY"), so it must name a concrete
    // action or explicitly say "none" — it can no longer just talk its way
    // out of using it. Best-effort: any failure here silently falls back to
    // the normal text-only reply the user already has.
    if (!uiAction) {
      try {
        const classifyRes = await fetch(
          `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [
                  {
                    text: "Jesteś klasyfikatorem intencji dla interfejsu JARVIS HUD. Oceń wiadomość użytkownika i zdecyduj, czy odpowiada ona DOKŁADNIE jednej z dostępnych akcji UI. Zawsze wywołaj narzędzie perform_ui_action z jedną wartością — jeśli żadna akcja nie pasuje (np. zwykła pogawędka, pytanie merytoryczne, prośba o treść), wybierz \"none\". Nie odpowiadaj tekstem, nie tłumacz się.",
                  },
                ],
              },
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: UI_ACTION_TOOL_NAME,
                      description: "Klasyfikacja: która akcja UI (jeśli którakolwiek) pasuje do wiadomości użytkownika.",
                      parameters: {
                        type: "object",
                        properties: {
                          action: {
                            type: "string",
                            enum: UI_ACTIONS_WITH_NONE as unknown as string[],
                            description: 'Dokładnie jedna wartość — konkretna akcja albo "none".',
                          },
                        },
                        required: ["action"],
                      },
                    },
                  ],
                },
              ],
              toolConfig: {
                functionCallingConfig: { mode: "ANY", allowedFunctionNames: [UI_ACTION_TOOL_NAME] },
              },
              generationConfig: { temperature: 0.1, maxOutputTokens: 50 },
              contents: [{ role: "user", parts: [{ text: input }] }],
            }),
          },
        );
        if (classifyRes.ok) {
          const classifyData = (await classifyRes.json()) as {
            candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          totalTokensIn += classifyData.usageMetadata?.promptTokenCount ?? 0;
          totalTokensOut += classifyData.usageMetadata?.candidatesTokenCount ?? 0;
          const classifyParts = classifyData.candidates?.[0]?.content?.parts ?? [];
          const classifyCall = classifyParts.flatMap((p) =>
            "functionCall" in p && p.functionCall ? [p.functionCall] : [],
          )[0];
          const requested = String((classifyCall?.args as Record<string, unknown> | undefined)?.action ?? "none");
          if (requested !== "none" && (UI_ACTIONS as readonly string[]).includes(requested)) {
            uiAction = requested as UiAction;
            toolCallLog.push({ name: UI_ACTION_TOOL_NAME, args: { action: requested, via: "classifier_fallback" } });
            await logEvent("info", "orchestrator", `ui action via classifier fallback: ${requested}`, {
              run_id: runId,
            } as Json);
          }
        }
      } catch {
        // Silent — the user still gets their normal text reply either way.
      }
    }

    const latencyMs = Date.now() - startedAt;

    await supabase
      .from("agent_runs")
      .update({
        status: "done",
        output: { text: finalText, tool_calls: toolCallLog } as Json,
        tokens_input: totalTokensIn || null,
        tokens_output: totalTokensOut || null,
        latency_ms: latencyMs,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await logEvent("info", "orchestrator", `run done · ${toolCallLog.length} tool calls · ${latencyMs}ms`, {
      run_id: runId,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
    } as Json);

    // Persist the visible turn (user message + final reply) so any device
    // logged into the same account sees the same conversation. Only for
    // top-level calls — delegated sub-runs don't own a conversation row.
    if (resolvedConversationId) {
      await supabase.from("messages").insert([
        { user_id: userId, conversation_id: resolvedConversationId, run_id: runId, role: "user", content: input },
        { user_id: userId, conversation_id: resolvedConversationId, run_id: runId, role: "jarvis", content: finalText },
      ]);
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", resolvedConversationId);
    }

    return {
      runId,
      status: "done",
      output: finalText,
      action: uiAction ?? undefined,
      conversationId: resolvedConversationId,
      tokensIn: totalTokensIn || undefined,
      tokensOut: totalTokensOut || undefined,
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
    await logEvent("error", "orchestrator", `run failed: ${msg}`, { run_id: runId } as Json);
    return { runId, status: "error", output: "", error: msg };
  }
}
