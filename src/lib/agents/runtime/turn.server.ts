// Jedna tura modelu: wybór dostawcy (Claude / Gemini), pusta tura z jedną
// powtórką, przejście Claude → Gemini i awaryjny Groq (plan naprawczy, etap 4:
// wydzielone z runtime.server.ts; klient modeli: src/lib/ai/llm/).
import type { Json } from "@/integrations/supabase/types";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_FALLBACK_MODEL } from "../models";
import { acceptsForcedToolChoice, callAnthropic } from "@/lib/ai/llm/anthropic";
import { callGemini } from "@/lib/ai/llm/gemini";
import { callGroq } from "@/lib/ai/llm/groq";
import { withPurpose } from "@/lib/ai/llm/ledger";
import type { GeminiUsageMetadata } from "@/lib/ai/llm/usage";
import type { GeminiPart } from "@/lib/ai/llm/types";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  GEMINI_MAX_RETRIES,
  GEMINI_RETRY_BACKOFF_MS,
  GEMINI_SAFETY_SETTINGS,
  GENERATE_DOCUMENT_TOOL,
} from "./constants";
import { meterUsage } from "./usage";
import type { RunContext, RunState } from "./types";

export type ModelTurn = {
  /** Claude padł i run przeszedł na Gemini — ten sam krok pętli od nowa. */
  retry: boolean;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  textOut: string;
};

export async function runModelTurn(
  ctx: RunContext,
  state: RunState,
  iter: number,
  forceGenerateDocument: boolean,
): Promise<ModelTurn> {
  const {
    agent,
    apiKey,
    groqApiKey,
    anthropicApiKey,
    systemPrompt,
    systemSuffix,
    modelRef,
    temperature,
    maxOutputTokens,
    runId,
    logEvent,
    runLedger,
  } = ctx;
  let functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let textOut = "";
  // Wymuszona tura generate_document na modelu Claude, który wymuszenia nie
  // przyjmuje (Opus 5.5 / Sonnet 5.5 — 400): od razu Gemini, jednym `info`
  // w logu zamiast nieudanego wywołania i ostrzeżenia z failoveru (etap 6b).
  // Bez klucza Gemini zostaje Claude bez wymuszenia (tool_choice auto).
  if (
    state.modelProvider === "anthropic" &&
    forceGenerateDocument &&
    apiKey &&
    !acceptsForcedToolChoice(state.model)
  ) {
    await logEvent(
      "info",
      AGENT_SLUGS.JARVIS,
      `${state.model} nie przyjmuje wymuszenia narzędzia — ${GENERATE_DOCUMENT_TOOL} i reszta runu idą na ${DEFAULT_GEMINI_MODEL}`,
      { run_id: runId, iter, configured_model: modelRef } as Json,
    );
    state.modelProvider = "gemini";
    state.model = DEFAULT_GEMINI_MODEL;
    return { retry: true, functionCalls, textOut };
  }
  try {
    if (state.modelProvider === "anthropic") {
      // Claude path — same canonical `contents`, same tool declarations,
      // same forced-tool pin as the Gemini path below. The adapter owns
      // the shape translation; everything after this block is identical
      // regardless of who served the turn.
      const claudeResult = await callAnthropic({
        apiKey: anthropicApiKey as string,
        model: state.model,
        systemPrompt,
        systemSuffix,
        cacheSystem: true,
        contents: state.contents,
        toolDeclarations: state.toolDeclarations.length > 0 ? state.toolDeclarations : undefined,
        forceToolName: forceGenerateDocument ? GENERATE_DOCUMENT_TOOL : undefined,
        temperature,
        maxOutputTokens,
        ledger: runLedger,
      });
      meterUsage(state, claudeResult.usage, claudeResult.costUsd);
      functionCalls = claudeResult.functionCalls;
      textOut = claudeResult.text;
      if (functionCalls.length === 0 && !textOut) {
        await logEvent("warn", AGENT_SLUGS.JARVIS, "empty Anthropic response", {
          run_id: runId,
          iter,
          model: state.model,
        } as Json);
      }
    } else {
      // PUSTA TURA GEMINI → JEDNA POWTÓRKA.
      //
      // Zaobserwowane na żywo (2026-10-09): po przełączeniu z Claude (brak
      // środków) gemini-2.5-flash zwrócił turę bez tekstu i bez wywołania
      // narzędzia (finishReason=STOP) — dwa razy z rzędu, na pytanie „co się
      // ostatnio wywaliło?". Pętla traktowała to jak koniec rozmowy, a
      // klasyfikator UI dokładał „Otwieram dziennik systemu." zamiast
      // raportu od S.H.I.E.L.D. Taka tura to awaria modelu, nie decyzja:
      // ponawiamy ją raz, na modelach flash z wyłączonym myśleniem (to ono
      // najczęściej „zjada" odpowiedź), zanim pętla się podda.
      for (let emptyRetry = 0; emptyRetry < 2; emptyRetry++) {
        const thinkingOff = forceGenerateDocument || (emptyRetry > 0 && /flash/i.test(state.model));
        const requestBody = JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }, { text: systemSuffix }] },
          generationConfig: {
            temperature,
            maxOutputTokens,
            // gemini-2.5-flash "thinks" by default, and those thinking
            // tokens are deducted from the SAME maxOutputTokens budget as
            // the actual response — for a forced structured call this can
            // starve the function-call JSON of budget mid-generation,
            // truncating it into invalid JSON (finishReason:
            // MALFORMED_FUNCTION_CALL, 0 usable calls). Live failure
            // (2026-08-14): generate_document forced via toolConfig ANY for
            // a 10-slide deck came back empty on repeated attempts with
            // exactly that finish reason. This call is pure mechanical
            // structuring, not reasoning, so thinking buys nothing — turning
            // it off frees the entire budget for the actual output. Must
            // live INSIDE generationConfig — Gemini 400s on it as a
            // top-level field ("Unknown name \"thinkingConfig\"").
            ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
          safetySettings: GEMINI_SAFETY_SETTINGS,
          // Gemini rejects an empty functionDeclarations array, and an
          // agent may legitimately have zero tools enabled (all toggled
          // off in Settings) — omit the `tools` key entirely in that case.
          ...(state.toolDeclarations.length > 0
            ? { tools: [{ functionDeclarations: state.toolDeclarations }] }
            : {}),
          ...(forceGenerateDocument
            ? {
                toolConfig: {
                  functionCallingConfig: {
                    mode: "ANY",
                    allowedFunctionNames: [GENERATE_DOCUMENT_TOOL],
                  },
                },
              }
            : {}),
          contents: state.contents,
        });

        // Gemini's shared-capacity models return HTTP 503 "high demand" in
        // bursts (observed live 2026-07-22: a 503 storm broke every
        // presentation run for minutes). Those are transient and usually
        // clear within a second or two, so retry the SAME request a few
        // times with backoff BEFORE falling over to Groq — the Groq failover
        // can't reliably handle our tool-calling shape (it 400s on
        // delegate_to_agent), so exhausting a quick retry against Gemini is
        // far more likely to succeed than switching providers.
        const res = await callGemini<{
          candidates?: Array<{
            content?: { role?: string; parts?: GeminiPart[] };
            finishReason?: string;
          }>;
          promptFeedback?: { blockReason?: string };
          usageMetadata?: GeminiUsageMetadata;
        }>({
          apiKey,
          model: state.model,
          body: requestBody,
          timeoutMs: 45_000,
          retries: GEMINI_MAX_RETRIES,
          backoffMs: GEMINI_RETRY_BACKOFF_MS,
          onRetry: (status, attempt, retries) =>
            logEvent(
              "warn",
              AGENT_SLUGS.JARVIS,
              `gemini HTTP ${status}, retry ${attempt}/${retries}`,
              {
                run_id: runId,
                iter,
              } as Json,
            ),
          ledger: runLedger,
        });
        // Model agenta wyłączony u dostawcy (404 — np. stary gemini-2.0-flash
        // zapisany w ustawieniach agenta): model domyślny z ostrzeżeniem
        // zamiast martwego runu (etap 6b). Ten sam krok pętli od nowa.
        if (!res.ok && res.status === 404 && state.model !== DEFAULT_GEMINI_MODEL) {
          await logEvent(
            "warn",
            AGENT_SLUGS.JARVIS,
            `model ${state.model} niedostępny u dostawcy (HTTP 404) — używam ${DEFAULT_GEMINI_MODEL}; zmień model agenta w Ustawieniach`,
            { run_id: runId, iter, configured_model: modelRef } as Json,
          );
          state.model = DEFAULT_GEMINI_MODEL;
          return { retry: true, functionCalls, textOut };
        }
        if (!res.ok) throw new Error(res.message);
        const data = res.data;
        meterUsage(state, res.usage, res.costUsd);

        const parts = data.candidates?.[0]?.content?.parts ?? [];
        functionCalls = parts.flatMap((p) =>
          "functionCall" in p && p.functionCall ? [p.functionCall] : [],
        );
        textOut = parts
          .flatMap((p) => ("text" in p && p.text ? [p.text] : []))
          .join("")
          .trim();

        // A turn that comes back with nothing at all (no function call, no
        // text) is otherwise silent — from the caller's perspective it looks
        // identical to "the model chose to stop", when it's almost always
        // Gemini's safety filter discarding the response server-side. Log
        // the real reason so a stuck run (e.g. forceGenerateDocument ending
        // with 0 tool calls) is diagnosable from System Logs instead of a
        // guessing game.
        if (functionCalls.length === 0 && !textOut) {
          const finishReason = data.candidates?.[0]?.finishReason;
          const blockReason = data.promptFeedback?.blockReason;
          if (finishReason || blockReason) {
            await logEvent(
              "warn",
              AGENT_SLUGS.JARVIS,
              `empty Gemini response · finishReason=${finishReason ?? "?"} blockReason=${blockReason ?? "?"}`,
              { run_id: runId, iter, forceGenerateDocument, retry: emptyRetry } as Json,
            );
          }
        }
        if (functionCalls.length > 0 || textOut || emptyRetry > 0) break;
        await logEvent(
          "warn",
          AGENT_SLUGS.JARVIS,
          `pusta tura Gemini — ponawiam ją raz${/flash/i.test(state.model) ? " bez myślenia" : ""}`,
          { run_id: runId, iter } as Json,
        );
      }
    }
  } catch (geminiErr) {
    // Emergency failover: Gemini errored (rate limit, 5xx, timeout,
    // network) — retry this exact turn against the free Groq tier
    // instead of failing the whole run, when a key is configured. The
    // running `contents` array stays in Gemini's canonical shape either
    // way (see llm/groq.ts), so subsequent iterations still try
    // Gemini first — this is a per-turn retry, not a permanent switch.
    const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);

    // Claude padł → powtórz TĘ SAMĄ turę na Gemini, zanim w ogóle
    // rozważymy Groq.
    //
    // Powód jest konkretny: klucz Anthropic bez środków na koncie
    // odpowiada błędem przy każdym wywołaniu. Bez tej ścieżki agent
    // ustawiony na Claude przewracał cały run — mimo że klucz Gemini
    // jest w tej aplikacji obowiązkowy i działa. Degradacja jakości
    // modelu jest nieporównanie lepsza niż martwy agent, a ostrzeżenie
    // w System Logs mówi wprost, co się stało.
    if (state.modelProvider === "anthropic") {
      await logEvent(
        "warn",
        AGENT_SLUGS.JARVIS,
        `Claude (${state.model}) nie odpowiedział — ta tura i reszta runu idą na ${DEFAULT_GEMINI_MODEL}: ${geminiMsg}`,
        { run_id: runId, iter, configured_model: modelRef } as Json,
      );
      state.modelProvider = "gemini";
      state.model = DEFAULT_GEMINI_MODEL;
      // Powtórka tego samego kroku pętli: `iter` wróci do bieżącej
      // wartości po inkrementacji. Nie zapętli się, bo provider jest
      // już przestawiony.
      return { retry: true, functionCalls, textOut };
    }

    if (!groqApiKey) throw geminiErr;
    await logEvent(
      "warn",
      AGENT_SLUGS.JARVIS,
      `${state.modelProvider} call failed, failing over to groq: ${geminiMsg}`,
      {
        run_id: runId,
        iter,
      } as Json,
    );
    try {
      const groqResult = await callGroq({
        apiKey: groqApiKey,
        model: DEFAULT_GROQ_FALLBACK_MODEL,
        systemPrompt: `${systemPrompt}${systemSuffix}`,
        contents: state.contents,
        toolDeclarations: state.toolDeclarations.length > 0 ? state.toolDeclarations : undefined,
        // Carry F.O.R.G.E.'s forced-tool-call through to the failover
        // path too — otherwise a Gemini outage lets F.O.R.G.E. answer in
        // prose on Groq and end with 0 tool calls (no file, no link).
        forceToolName: forceGenerateDocument ? GENERATE_DOCUMENT_TOOL : undefined,
        temperature,
        maxOutputTokens,
        ledger: withPurpose(runLedger, "turn_failover"),
      });
      meterUsage(state, groqResult.usage, groqResult.costUsd);
      functionCalls = groqResult.functionCalls;
      textOut = groqResult.text;
      await logEvent("info", AGENT_SLUGS.JARVIS, "failover to groq succeeded", {
        run_id: runId,
        iter,
      } as Json);
    } catch (groqErr) {
      const groqMsg = groqErr instanceof Error ? groqErr.message : String(groqErr);
      await logEvent("error", AGENT_SLUGS.JARVIS, `groq failover also failed: ${groqMsg}`, {
        run_id: runId,
        iter,
      } as Json);
      throw geminiErr;
    }
  }
  return { retry: false, functionCalls, textOut };
}
