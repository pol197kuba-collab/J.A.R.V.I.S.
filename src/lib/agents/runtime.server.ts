// Server-only J.A.R.V.I.S. core: runOrchestrator — jeden run agenta jako
// czytelna sekwencja kroków (plan naprawczy, etap 4). Kroki mieszkają
// w src/lib/agents/runtime/:
//   context.server.ts  — agent, klucze, zespół, prompt, model, budżet, wiersz runu
//   tools.server.ts    — deklaracje narzędzi i ich wykonanie (bramka, delegacja)
//   turn.server.ts     — jedna tura modelu (dostawca, powtórka, failover)
//   finalize.server.ts — klasyfikator, tekst zastępczy, zapis runu, wiadomości
//   prompt.ts, constants.ts, classifier.server.ts, usage.ts, types.ts

import type { AgentRunResult } from "./runtime.functions";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { UI_ACTIONS } from "@/lib/constants/uiActions";
import type { GeminiContent } from "@/lib/ai/llm/types";
import { ZERO_USAGE } from "@/lib/ai/llm/usage";
import { GENERATE_DOCUMENT_TOOL } from "./runtime/constants";
import { prepareRun } from "./runtime/context.server";
import { declareTools, executeToolCalls } from "./runtime/tools.server";
import { runModelTurn } from "./runtime/turn.server";
import { failRun, finalizeRun } from "./runtime/finalize.server";
import type { OrchestratorInput, RunState } from "./runtime/types";

export { UI_ACTIONS };
export { UI_ACTION_CONFIRMATIONS, UNTRUSTED_CONTENT_NOTICE } from "./runtime/constants";
export {
  runClassifierFallback,
  type ClassifierFallbackDeps,
  type ClassifierFallbackResult,
} from "./runtime/classifier.server";
export type { OrchestratorInput } from "./runtime/types";

export async function runOrchestrator(args: OrchestratorInput): Promise<AgentRunResult> {
  // 1. Przygotowanie: agent, klucze, zespół, prompt, model, budżet, wiersz runu.
  const { ctx, modelProvider, model } = await prepareRun(args);

  const state: RunState = {
    modelProvider,
    model,
    contents: [],
    toolDeclarations: [],
    declaredToolNames: new Set(),
    allowDelegate: false,
    isProducer: false,
    producerCalledGenerate: false,
    finalText: "",
    uiAction: null,
    toolCallLog: [],
    untrustedSeen: args.untrustedContext ?? false,
    attachments: [],
    openDocument: null,
    enrichDocument: null,
    documentJob: null,
    usage: ZERO_USAGE,
    costUsd: 0,
    unpriced: false,
  };

  try {
    // 2. Rozmowa i narzędzia, które model dostaje w tym runie.
    state.contents = [
      ...args.history
        .filter((h) => h.text && h.text.trim())
        .map<GeminiContent>((h) => ({
          role: h.role === "jarvis" ? "model" : "user",
          parts: [{ text: h.text }],
        })),
      { role: "user", parts: [{ text: args.input }] },
    ];
    Object.assign(state, await declareTools(ctx));

    // F.O.R.G.E.'s whole job is to CALL generate_document — but live testing
    // showed the model instead describing the presentation in prose and
    // ending its (delegated) run with 0 tool calls, so J.A.R.V.I.S.
    // relayed a confident "plik gotowy" with no file and no link ever
    // produced. Same lesson as the download-link saga: don't ask the model
    // to reliably do the one thing it must — force it. Until generate_document
    // has actually run once this turn, the producer's request pins Gemini to
    // that function (functionCallingConfig mode ANY); afterwards it switches
    // back to AUTO so the follow-up turn can produce the text summary.
    state.isProducer =
      ctx.agent.slug === AGENT_SLUGS.FORGE &&
      state.toolDeclarations.some((d) => d.name === GENERATE_DOCUMENT_TOOL);

    // 3. Pętla: tura modelu → narzędzia, aż model odpowie tekstem.
    for (let iter = 0; iter < ctx.maxToolIterations; iter++) {
      const forceGenerateDocument = state.isProducer && !state.producerCalledGenerate;
      const turn = await runModelTurn(ctx, state, iter, forceGenerateDocument);
      if (turn.retry) {
        // Powtórka tego samego kroku pętli: `iter` wróci do bieżącej wartości
        // po inkrementacji. Nie zapętli się, bo provider jest już przestawiony.
        iter -= 1;
        continue;
      }
      if (turn.functionCalls.length === 0) {
        state.finalText = turn.textOut;
        break;
      }
      await executeToolCalls(ctx, state, turn.functionCalls, iter, runOrchestrator);

      if (iter === ctx.maxToolIterations - 1) {
        // Force a final text reply on the next (skipped) turn by breaking here
        // but we already broke out via loop bound. If we get here we still
        // have unconsumed tool output; fall through to a graceful message.
        state.finalText =
          "I have completed several tool calls but ran out of orchestration cycles. Please rephrase or ask me to continue.";
      }
    }

    // 4. Koniec: klasyfikator, tekst zastępczy, zapis runu, wiadomości.
    return await finalizeRun(ctx, state);
  } catch (err) {
    return await failRun(ctx, state, err);
  }
}
