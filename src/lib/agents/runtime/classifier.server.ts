// Klasyfikator UI — awaryjna, wymuszona decyzja „czy to polecenie dla
// interfejsu” po turze bez narzędzi (plan naprawczy, etap 4: wydzielony
// z runtime.server.ts; bramka z etapu 3 w finalize.server.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { getToolByName } from "../tools.server";
import { DEFAULT_GROQ_CLASSIFIER_MODEL } from "../models";
import { callGemini } from "@/lib/ai/llm/gemini";
import { callGroq } from "@/lib/ai/llm/groq";
import { withPurpose, type LedgerContext } from "@/lib/ai/llm/ledger";
import { addUsage, ZERO_USAGE, type GeminiUsageMetadata, type LlmUsage } from "@/lib/ai/llm/usage";
import type { GeminiPart } from "@/lib/ai/llm/types";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { UI_ACTIONS, type UiAction } from "@/lib/constants/uiActions";
import {
  GEMINI_SAFETY_SETTINGS,
  QUEUE_DOCUMENT_JOB_TOOL_NAME,
  UI_ACTION_CONFIRMATIONS,
  UI_ACTION_TOOL_NAME,
} from "./constants";

export type ClassifierFallbackDeps = {
  /** Present → try the free Groq tier first; null/undefined → go straight to Gemini. */
  groqApiKey: string | null | undefined;
  input: string;
  /** Gemini model id used only for the Gemini leg (Groq always uses DEFAULT_GROQ_CLASSIFIER_MODEL). */
  model: string;
  apiKey: string;
  effectiveUiActionsWithNone: string[];
  runId: string;
  /** Needed only to actually enqueue a job if the classifier picks
   *  queue_document_job — omit (with queueDocumentJobEnabled false/omitted)
   *  for a plain UI-action-only classifier pass. */
  supabase?: SupabaseClient<Database>;
  userId?: string;
  agentId?: string;
  /** Whether this agent actually has queue_document_job bound — offering it to the
   *  classifier when it isn't would let the fallback "succeed" at calling a tool
   *  the main turn could never have called either. Defaults to false. */
  queueDocumentJobEnabled?: boolean;
  /** Księga zużycia — klasyfikator zapisuje się w niej z celem "classifier". */
  ledger?: LedgerContext;
  logEvent: (
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    meta?: Json,
  ) => Promise<void>;
};

export type ClassifierFallbackResult = {
  uiAction: UiAction | null;
  /** Set when the classifier decided this was a document/presentation request
   *  needing research and enqueued it via queue_document_job. */
  documentJob: { id: string } | null;
  finalText: string | null;
  toolCallLogEntry: { name: string; args: Record<string, unknown> } | null;
  tokensInDelta: number;
  tokensOutDelta: number;
  /** Pełne zużycie klasyfikatora (Groq i/lub Gemini) — liczy się do runu. */
  usage: LlmUsage;
  /** Koszt po faktycznych modelach (null = któryś spoza cennika). */
  costUsd: number | null;
};

type ClassifierCoreResult = Omit<ClassifierFallbackResult, "usage" | "costUsd">;
type UsageTracker = (usage: LlmUsage, costUsd: number | null) => void;

// Forces one narrow yes/no decision ("does this message match a UI action?")
// via the free Groq tier when a key is configured, falling back to Gemini on
// any Groq failure or when no key is set. Extracted from runOrchestrator so
// the request-building/response-parsing that used to be written out twice
// (once per provider) lives in one place — the two providers still need
// separate branches internally (different APIs, different failure shapes),
// and those branches deliberately preserve today's asymmetric side effects
// (e.g. Groq's classifier tokens are not counted toward the run's totals,
// only Gemini's are; Groq logs its "none" outcome, Gemini's HTTP-200-no-call
// case doesn't) rather than silently normalizing them.

export async function runClassifierFallback(
  deps: ClassifierFallbackDeps,
): Promise<ClassifierFallbackResult> {
  // Etap 2 (A9/A20): klasyfikator płaci jak każde wywołanie — Groq też.
  let usage: LlmUsage = ZERO_USAGE;
  let costUsd: number | null = 0;
  const track: UsageTracker = (u, c) => {
    usage = addUsage(usage, u);
    costUsd = costUsd === null || c === null ? null : costUsd + c;
  };
  const result = await classifyCore(deps, track);
  return {
    ...result,
    tokensInDelta: usage.input,
    tokensOutDelta: usage.output + usage.thinking,
    usage,
    costUsd,
  };
}

async function classifyCore(
  deps: ClassifierFallbackDeps,
  track: UsageTracker,
): Promise<ClassifierCoreResult> {
  const classifierLedger = deps.ledger && withPurpose(deps.ledger, "classifier");
  const {
    groqApiKey,
    input,
    model,
    apiKey,
    effectiveUiActionsWithNone,
    runId,
    supabase,
    userId,
    agentId,
    queueDocumentJobEnabled,
    logEvent,
  } = deps;

  // Only offered when the real tool is actually bound for this agent —
  // otherwise the fallback could "succeed" at a tool the main turn could
  // never have called either, which would just move the bug rather than
  // fix it.
  const queueTool = queueDocumentJobEnabled ? getToolByName(QUEUE_DOCUMENT_JOB_TOOL_NAME) : null;

  const classifierSystemPrompt = queueTool
    ? 'Jesteś klasyfikatorem intencji dla interfejsu JARVIS HUD. Oceń wiadomość użytkownika i zdecyduj DOKŁADNIE JEDNO z trzech: (1) czy pasuje do jednej z dostępnych akcji UI — wywołaj perform_ui_action; (2) czy to prośba o przygotowanie dokumentu/prezentacji/raportu NA TEMAT wymagającym zebrania treści (np. "zrób mi prezentację o X", "przygotuj raport o Y") — wywołaj queue_document_job z krótkim tytułem i pełnym opisem zadania badawczego dla brief; (3) jeśli żadne z powyższych nie pasuje (zwykła pogawędka, pytanie merytoryczne bez prośby o plik) — wywołaj perform_ui_action z action="none". Zawsze wywołaj DOKŁADNIE jedno z tych dwóch narzędzi. Pytania i prośby o informację lub raport (np. „co się ostatnio wywaliło?”, „jak idzie zadanie?”, „niech SHIELD sprawdzi błędy”) to NIE są akcje UI — wybierz "none", nawet gdy dotyczą logów czy zadań. Akcję UI wybieraj tylko przy wyraźnym poleceniu otwarcia lub pokazania ekranu (np. „otwórz logi”, „pokaż dashboard”). Nie odpowiadaj tekstem, nie tłumacz się.'
    : 'Jesteś klasyfikatorem intencji dla interfejsu JARVIS HUD. Oceń wiadomość użytkownika i zdecyduj, czy odpowiada ona DOKŁADNIE jednej z dostępnych akcji UI. Zawsze wywołaj narzędzie perform_ui_action z jedną wartością — jeśli żadna akcja nie pasuje (np. zwykła pogawędka, pytanie merytoryczne, prośba o treść), wybierz "none". Pytania i prośby o informację lub raport (np. „co się ostatnio wywaliło?”, „jak idzie zadanie?”, „niech SHIELD sprawdzi błędy”) to NIE są akcje UI — wybierz "none", nawet gdy dotyczą logów czy zadań. Akcję UI wybieraj tylko przy wyraźnym poleceniu otwarcia lub pokazania ekranu (np. „otwórz logi”, „pokaż dashboard”). Nie odpowiadaj tekstem, nie tłumacz się.';
  const classifierToolDeclaration = {
    name: UI_ACTION_TOOL_NAME,
    description:
      "Klasyfikacja: która akcja UI (jeśli którakolwiek) pasuje do wiadomości użytkownika.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: effectiveUiActionsWithNone,
          description: 'Dokładnie jedna wartość — konkretna akcja albo "none".',
        },
      },
      required: ["action"],
    },
  };
  const classifierToolDeclarations = queueTool
    ? [classifierToolDeclaration, queueTool.declaration]
    : [classifierToolDeclaration];
  const classifierAllowedNames = queueTool
    ? [UI_ACTION_TOOL_NAME, QUEUE_DOCUMENT_JOB_TOOL_NAME]
    : [UI_ACTION_TOOL_NAME];

  // Shared by both provider branches below: the classifier decided this is a
  // document/presentation job, so actually enqueue it (reusing the real
  // tool's own execute(), not a reimplementation) and report a friendly
  // "started" reply instead of the model's own text (which never ran).
  const handleQueueDocumentJob = async (
    call: { name: string; args?: Record<string, unknown> },
    via: string,
  ): Promise<ClassifierCoreResult> => {
    // Only ever called when queueTool is truthy, which itself only happens
    // when the caller opted in via queueDocumentJobEnabled — the same
    // caller is responsible for also passing real supabase/userId/agentId
    // in that case (see runOrchestrator's call site below).
    const response = await queueTool!.execute(call.args ?? {}, {
      supabase: supabase!,
      userId: userId!,
      agentId: agentId!,
      runId,
      apiKey,
      model,
      logEvent,
    });
    if (response.ok !== true || typeof response.job_id !== "string") {
      await logEvent(
        "warn",
        AGENT_SLUGS.JARVIS,
        `queue_document_job via classifier fallback (${via}) failed: ${JSON.stringify(response).slice(0, 200)}`,
        { run_id: runId } as Json,
      );
      return {
        uiAction: null,
        documentJob: null,
        finalText: null,
        toolCallLogEntry: { name: "classifier_queue_document_job_failed", args: { via } },
        tokensInDelta: 0,
        tokensOutDelta: 0,
      };
    }
    await logEvent(
      "info",
      AGENT_SLUGS.JARVIS,
      `document job queued via classifier fallback (${via}): ${response.job_id}`,
      { run_id: runId } as Json,
    );
    return {
      uiAction: null,
      documentJob: { id: response.job_id },
      finalText:
        "Zaczynam przygotowywać ten dokument, Panie Sławiński — dam znać powiadomieniem, gdy będzie gotowy.",
      toolCallLogEntry: {
        name: QUEUE_DOCUMENT_JOB_TOOL_NAME,
        args: { ...(call.args ?? {}), via: `classifier_fallback_${via}` },
      },
      tokensInDelta: 0,
      tokensOutDelta: 0,
    };
  };

  // This entire pass exists only to force one narrow decision — it never
  // needs Gemini's specific capabilities. Route it through the free Groq
  // tier when a key is configured, saving a full paid Gemini call on every
  // single turn that doesn't already invoke a tool (the majority of turns).
  // Falls through to the original Gemini path below on any Groq failure or
  // when no Groq key is set — never a regression.
  if (groqApiKey) {
    try {
      const groqResult = await callGroq({
        apiKey: groqApiKey,
        model: DEFAULT_GROQ_CLASSIFIER_MODEL,
        systemPrompt: classifierSystemPrompt,
        contents: [{ role: "user", parts: [{ text: input }] }],
        toolDeclarations: classifierToolDeclarations,
        forceToolName: classifierAllowedNames.length === 1 ? UI_ACTION_TOOL_NAME : undefined,
        forceAnyTool: classifierAllowedNames.length > 1,
        temperature: 0.1,
        // A plain UI-action pick only needs the enum value (50 is plenty);
        // queue_document_job additionally has to generate a title + brief.
        maxOutputTokens: queueTool ? 200 : 50,
        ledger: classifierLedger,
      });
      track(groqResult.usage, groqResult.costUsd);
      const call = groqResult.functionCalls[0];
      if (queueTool && call?.name === QUEUE_DOCUMENT_JOB_TOOL_NAME) {
        return await handleQueueDocumentJob(call, "groq");
      }
      const requested = String(
        (call?.args as Record<string, unknown> | undefined)?.action ?? "none",
      );
      if (requested !== "none" && (UI_ACTIONS as readonly string[]).includes(requested)) {
        const uiAction = requested as UiAction;
        await logEvent(
          "info",
          AGENT_SLUGS.JARVIS,
          `ui action via classifier fallback (groq): ${requested}`,
          { run_id: runId } as Json,
        );
        return {
          uiAction,
          documentJob: null,
          finalText: UI_ACTION_CONFIRMATIONS[uiAction],
          toolCallLogEntry: {
            name: UI_ACTION_TOOL_NAME,
            args: { action: requested, via: "classifier_fallback_groq" },
          },
          tokensInDelta: 0,
          tokensOutDelta: 0,
        };
      }
      // Also logged on the "none" branch (the common case — most turns
      // aren't UI commands) so System Logs shows Groq was actually hit
      // every turn, not only on the rare UI-action hits.
      await logEvent("info", AGENT_SLUGS.JARVIS, "classifier fallback via groq: none", {
        run_id: runId,
      } as Json);
      return {
        uiAction: null,
        documentJob: null,
        finalText: null,
        toolCallLogEntry: { name: "classifier_none", args: { requested, via: "groq" } },
        tokensInDelta: 0,
        tokensOutDelta: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logEvent("warn", AGENT_SLUGS.JARVIS, `classifier groq failed, falling back: ${msg}`, {
        run_id: runId,
      } as Json);
      // falls through to Gemini below
    }
  }

  try {
    const classifyRes = await callGemini<{
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      usageMetadata?: GeminiUsageMetadata;
    }>({
      apiKey,
      model,
      body: {
        systemInstruction: { parts: [{ text: classifierSystemPrompt }] },
        tools: [{ functionDeclarations: classifierToolDeclarations }],
        safetySettings: GEMINI_SAFETY_SETTINGS,
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: classifierAllowedNames,
          },
        },
        generationConfig: { temperature: 0.1, maxOutputTokens: queueTool ? 200 : 50 },
        contents: [{ role: "user", parts: [{ text: input }] }],
      },
      timeoutMs: 30_000,
      ledger: classifierLedger,
    });
    if (classifyRes.ok) {
      track(classifyRes.usage, classifyRes.costUsd);
      const classifyData = classifyRes.data;
      const tokensInDelta = classifyRes.usage.input;
      const tokensOutDelta = classifyRes.usage.output + classifyRes.usage.thinking;
      const classifyParts = classifyData.candidates?.[0]?.content?.parts ?? [];
      const classifyCall = classifyParts.flatMap((p) =>
        "functionCall" in p && p.functionCall ? [p.functionCall] : [],
      )[0];
      if (!classifyCall) {
        // Model returned 200 but no functionCall part — visible now instead
        // of silently vanishing, so we can see WHY next time.
        return {
          uiAction: null,
          documentJob: null,
          finalText: null,
          toolCallLogEntry: {
            name: "classifier_no_function_call",
            args: { raw: JSON.stringify(classifyData).slice(0, 300) },
          },
          tokensInDelta,
          tokensOutDelta,
        };
      }
      if (queueTool && classifyCall.name === QUEUE_DOCUMENT_JOB_TOOL_NAME) {
        const result = await handleQueueDocumentJob(classifyCall, "gemini");
        return { ...result, tokensInDelta, tokensOutDelta };
      }
      const requested = String(
        (classifyCall.args as Record<string, unknown> | undefined)?.action ?? "none",
      );
      if (requested !== "none" && (UI_ACTIONS as readonly string[]).includes(requested)) {
        const uiAction = requested as UiAction;
        await logEvent(
          "info",
          AGENT_SLUGS.JARVIS,
          `ui action via classifier fallback: ${requested}`,
          { run_id: runId } as Json,
        );
        return {
          uiAction,
          documentJob: null,
          finalText: UI_ACTION_CONFIRMATIONS[uiAction],
          toolCallLogEntry: {
            name: UI_ACTION_TOOL_NAME,
            args: { action: requested, via: "classifier_fallback" },
          },
          tokensInDelta,
          tokensOutDelta,
        };
      }
      return {
        uiAction: null,
        documentJob: null,
        finalText: null,
        toolCallLogEntry: { name: "classifier_none", args: { requested } },
        tokensInDelta,
        tokensOutDelta,
      };
    }
    // Błąd sieci (bez statusu) idzie ścieżką wyjątku, jak dotąd.
    if (classifyRes.status === null) {
      throw new Error(classifyRes.error ?? classifyRes.message);
    }
    // HTTP-level failure — surface status + body instead of swallowing it.
    const bodyText = classifyRes.bodyText;
    await logEvent("warn", AGENT_SLUGS.JARVIS, `classifier HTTP ${classifyRes.status}`, {
      run_id: runId,
      body_preview: bodyText.slice(0, 200),
    } as Json);
    return {
      uiAction: null,
      documentJob: null,
      finalText: null,
      toolCallLogEntry: {
        name: "classifier_http_error",
        args: { status: classifyRes.status, body: bodyText.slice(0, 300) },
      },
      tokensInDelta: 0,
      tokensOutDelta: 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("warn", AGENT_SLUGS.JARVIS, `classifier exception: ${msg}`, {
      run_id: runId,
    } as Json);
    return {
      uiAction: null,
      documentJob: null,
      finalText: null,
      toolCallLogEntry: { name: "classifier_exception", args: { message: msg } },
      tokensInDelta: 0,
      tokensOutDelta: 0,
    };
  }
}
