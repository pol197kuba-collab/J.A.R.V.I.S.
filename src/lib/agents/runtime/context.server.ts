// Przygotowanie runu: agent, klucze, zespół, prompt, model, budżet, rozmowa,
// wiersz agent_runs i logowanie (plan naprawczy, etap 4: wydzielone
// z runtime.server.ts).
import type { Json } from "@/integrations/supabase/types";
import { DEFAULT_GEMINI_MODEL, parseModelRef, ANTHROPIC_PREFIX } from "../models";
import { chooseModel } from "../budget";
import { currentBudget } from "../budget.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { UI_ACTIONS } from "@/lib/constants/uiActions";
import { raiseProviderAlarm } from "@/lib/system/providerAlarm.server";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_TEMPERATURE,
  UI_ACTIONS_WITH_NONE,
} from "./constants";
import { basePromptFor, dateSection, teamRosterSection, uiAccessSection } from "./prompt";
import type { AgentLoopInput, RunContext } from "./types";
import { readOwnerSecrets } from "@/lib/secrets/ownerSecrets.server";

export type PreparedRun = {
  ctx: RunContext;
  /** Dostawca i model po kluczach i budżecie — dalej zmienne w RunState. */
  modelProvider: string;
  model: string;
};

export async function prepareRun(args: AgentLoopInput): Promise<PreparedRun> {
  const {
    supabase,
    userId,
    agentSlug,
    input,
    history,
    delegationDepth = 0,
    conversationId: incomingConversationId = null,
    parentRunId = null,
  } = args;

  // Delegated sub-runs (delegate_to_agent hops) never face the user: their
  // "input" is the parent's task text and their output goes back to the
  // parent, not to chat/voice. UI control is therefore meaningless there —
  // the perform_ui_action tool, its system-prompt pitch AND the fallback
  // classifier are all skipped, so a delegated Herald/Metric run can't
  // log a spurious "steruje interfejsem" entry or have its real answer
  // overwritten by a misclassified navigation confirmation.
  const isDelegatedRun = delegationDepth > 0 || parentRunId != null;

  // 1. Resolve agent (fallback: J.A.R.V.I.S.).
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id, name, slug, model, config")
    .eq("owner_id", userId)
    .eq("slug", agentSlug)
    .maybeSingle();
  if (agentErr) throw new Error(`Agent lookup failed: ${agentErr.message}`);
  if (!agent) throw new Error(`Agent not found: ${agentSlug}`);

  // 2. Resolve Gemini API key (required) + Groq API key (optional — free-tier
  // fallback, used only for the UI-action classifier pass and emergency
  // failover, never as the primary reasoning engine) from user_secrets.
  const { data: secret } = await readOwnerSecrets(
    userId,
    "gemini_api_key, groq_api_key, anthropic_api_key",
  );
  const apiKey = secret?.gemini_api_key?.trim();
  if (!apiKey) {
    throw new Error(
      "Brak klucza Gemini. Wpisz go w Settings → AI Core, aby uruchomić Agent Runtime.",
    );
  }
  const groqApiKey = secret?.groq_api_key?.trim() || null;
  const anthropicApiKey = secret?.anthropic_api_key?.trim() || null;

  const configObj: Record<string, unknown> =
    agent.config && typeof agent.config === "object" && !Array.isArray(agent.config)
      ? (agent.config as Record<string, unknown>)
      : {};

  const agentSpecific =
    typeof configObj.system_prompt === "string" && configObj.system_prompt.trim()
      ? configObj.system_prompt
      : null;

  // Team roster — every agent should know who else is on the payroll so the
  // J.A.R.V.I.S. can delegate and any agent can name-drop a teammate instead
  // of denying they exist.
  const { data: roster } = await supabase
    .from("agents")
    .select("slug, name, role, description, is_enabled")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  const teammates = (roster ?? []).filter((r) => r.slug !== agent.slug);

  // `system_check` is a purely decorative UI action (a hardcoded "wszystko
  // sprawne" line, zero real content) that predates S.H.I.E.L.D. and was never
  // wired to it. Three rounds of prompt-only carve-outs for this exact
  // collision (open_agents wording, then system_check wording, then this)
  // each got defeated by a new phrasing — the aggressive "always call
  // perform_ui_action" instruction reliably out-argues a textual exception
  // no matter how it's worded. Once S.H.I.E.L.D. can actually answer this for
  // real, the decorative option is strictly redundant AND actively
  // misleading (a fake "all good" beats a real diagnostic), so it's
  // removed from the declared enum outright whenever an enabled S.H.I.E.L.D.
  // exists — the model then has no way to select it, by construction,
  // rather than one more instruction to hopefully win a wording race.
  const hasEnabledShield = teammates.some((t) => t.slug === AGENT_SLUGS.SHIELD && t.is_enabled);
  const effectiveUiActions: string[] = hasEnabledShield
    ? UI_ACTIONS.filter((a) => a !== "system_check")
    : [...UI_ACTIONS];
  const effectiveUiActionsWithNone: string[] = hasEnabledShield
    ? UI_ACTIONS_WITH_NONE.filter((a) => a !== "system_check")
    : [...UI_ACTIONS_WITH_NONE];

  // Prompt: bazowy (J.A.R.V.I.S. / własny agenta), skład zespołu z zasadami
  // delegowania, sekcja dostępu do interfejsu — sekcje i ich uzasadnienia
  // w runtime/prompt.ts.
  const basePrompt = basePromptFor(agent.slug, agentSpecific);

  // Etap 3 (A10): stała część promptu osobno, data i godzina osobno, ZA nią.
  // Godzina zmienia się co minutę — doklejona do całości unieważniała cache
  // promptu przy każdej turze.
  const systemPrompt = `${basePrompt}${teamRosterSection(teammates, agent.slug)}${uiAccessSection(isDelegatedRun)}`;
  const systemSuffix = dateSection(new Date());

  // Model resolution: agent override → user default → hardcoded fallback.
  let modelRef = agent.model?.trim() ?? "";
  if (!modelRef) {
    const { data: prefs } = await supabase
      .from("user_settings")
      .select("default_model")
      .eq("owner_id", userId)
      .maybeSingle();
    modelRef = prefs?.default_model?.trim() || DEFAULT_GEMINI_MODEL;
  }

  // An "anthropic:"-prefixed model routes this turn to Claude. The Gemini key
  // stays mandatory either way — web_search grounding and the memory
  // embeddings are Gemini-only tools and run regardless of who serves the
  // conversational turn.
  //
  // Choosing Claude without a key must not brick the agent: degrade to the
  // Gemini default instead. The warning it deserves is emitted further down,
  // once logEvent (which needs the run row) exists — silently running a
  // different model than the one configured would be the worse failure.
  const parsedModel = parseModelRef(modelRef);
  const missingAnthropicKey = parsedModel.provider === "anthropic" && !anthropicApiKey;
  // Oba są zmienne, bo tura potrafi zjechać z Claude na Gemini w trakcie
  // runu — patrz obsługa błędu w pętli narzędziowej niżej.
  let modelProvider = missingAnthropicKey ? "gemini" : parsedModel.provider;
  let model = missingAnthropicKey ? DEFAULT_GEMINI_MODEL : parsedModel.modelId;

  // ---------- Budżet ----------
  // Po przekroczeniu limitu miesięcznego schodzimy o jeden stopień w dół
  // zamiast odmawiać pracy: twarde „nie" znaczyłoby, że J.A.R.V.I.S. milknie
  // w środku rozmowy, a po dwóch takich wieczorach limit i tak zostałby
  // podniesiony — czyli zabezpieczenie zniknęłoby zamiast zadziałać.
  //
  // Odczyt nigdy nie rzuca (patrz currentBudget): awaria odczytu budżetu nie
  // może być powodem, dla którego agent nie odpowiada.
  const budget = await currentBudget(supabase, userId);
  const modelDecision = chooseModel(
    modelProvider === "anthropic" ? `${ANTHROPIC_PREFIX}${model}` : model,
    budget,
  );
  if (modelDecision.downgraded) {
    const reparsed = parseModelRef(modelDecision.model);
    modelProvider = reparsed.provider;
    model = reparsed.modelId;
  }

  const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const temperature = clampNum(configObj.temperature, 0, 1, DEFAULT_TEMPERATURE);
  const maxOutputTokens = clampNum(
    configObj.max_output_tokens,
    64,
    8192,
    DEFAULT_MAX_OUTPUT_TOKENS,
  );
  const maxToolIterations = Math.round(
    clampNum(configObj.max_tool_iterations, 1, 12, DEFAULT_MAX_TOOL_ITERATIONS),
  );

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
      parent_run_id: parentRunId,
      status: "running",
      input: { text: input, history_len: history.length },
      started_at: new Date(startedAt).toISOString(),
    })
    .select("id")
    .single();
  if (runErr) throw new Error(`Run insert failed: ${runErr.message}`);
  const runId = runRow.id;

  // Widget-status fields (public.agents.status/current_task/progress) — best
  // effort, structural plumbing for the interactive agent-status widget.
  // Not awaited-and-checked like the run row above: a hiccup here shouldn't
  // fail the whole turn, only leave the status widget momentarily stale.
  await supabase
    .from("agents")
    .update({
      status: "busy",
      current_task: input.slice(0, 200),
      progress: 0,
      busy_since: new Date(startedAt).toISOString(),
    })
    .eq("id", agent.id);

  // logEvent helper — writes to system_events so the System Logs page shows real telemetry.
  const logEvent = async (
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    meta?: Json,
  ) => {
    await supabase.from("system_events").insert({
      owner_id: userId,
      level,
      source,
      message,
      meta: (meta ?? {}) as Json,
    });
    if (level !== "info") await raiseProviderAlarm(supabase, userId, message, source);
  };

  // Zmiana modelu w połowie miesiąca bez śladu w logu wygląda jak awaria
  // („dlaczego on nagle głupieje"). To jedyne miejsce, w którym da się
  // później odtworzyć, że to był budżet, a nie model.
  if (modelDecision.downgraded) {
    await logEvent(
      "warn",
      AGENT_SLUGS.JARVIS,
      `budżet wyczerpany · ${modelDecision.requested} → ${modelDecision.model}`,
      {
        run_id: runId,
        spent_usd: Math.round(budget.spentUsd * 1_000_000) / 1_000_000,
        limit_usd: budget.limitUsd,
      } as Json,
    );
  }

  await logEvent("info", AGENT_SLUGS.JARVIS, `run started · model ${model}`, {
    run_id: runId,
    agent: agentSlug,
    input_preview: input.slice(0, 120),
  } as Json);

  if (missingAnthropicKey) {
    await logEvent(
      "warn",
      AGENT_SLUGS.JARVIS,
      `agent ${agentSlug}: model ${modelRef} wymaga klucza Anthropic (Ustawienia → Claude) — używam ${DEFAULT_GEMINI_MODEL}`,
      { run_id: runId, agent: agentSlug, configured_model: modelRef } as Json,
    );
  }

  return {
    ctx: {
      supabase,
      userId,
      agentSlug,
      input,
      delegationDepth,
      isDelegatedRun,
      agent: { id: agent.id, name: agent.name, slug: agent.slug },
      apiKey,
      groqApiKey,
      anthropicApiKey,
      teammates,
      effectiveUiActions,
      effectiveUiActionsWithNone,
      systemPrompt,
      systemSuffix,
      modelRef,
      temperature,
      maxOutputTokens,
      maxToolIterations,
      conversationId: resolvedConversationId,
      runId,
      startedAt,
      logEvent,
      runLedger: { db: supabase, ownerId: userId, module: "agents", purpose: "turn", runId },
    },
    modelProvider,
    model,
  };
}
