// Koniec runu: klasyfikator UI (z bramką z etapu 3), linki do plików, tekst
// zastępczy, zapis runu i statusu agenta, wiadomości rozmowy; osobno ścieżka
// błędu (plan naprawczy, etap 4: wydzielone z runtime.server.ts).
import type { Json } from "@/integrations/supabase/types";
import type { AgentRunResult } from "../runtime.functions";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { looksLikeDocumentRequest, looksLikeUiCommand } from "@/lib/commands/intentGate";
import { runClassifierFallback } from "./classifier.server";
import { meterUsage, runUsageColumns } from "./usage";
import type { RunContext, RunState } from "./types";

export async function finalizeRun(ctx: RunContext, state: RunState): Promise<AgentRunResult> {
  const {
    supabase,
    userId,
    input,
    delegationDepth,
    isDelegatedRun,
    agent,
    apiKey,
    groqApiKey,
    effectiveUiActionsWithNone,
    runId,
    startedAt,
    logEvent,
    runLedger,
  } = ctx;
  // Fallback classifier pass. Base models tend to have a strong learned
  // habit of claiming "I can't control the UI" even when a real tool is
  // declared and instructed — this shows up especially on loosely phrased
  // requests. If the main AUTO-mode turn above never called
  // perform_ui_action, force one more narrow decision: restrict the model
  // to ONLY that tool (tool_config mode "ANY"), so it must name a concrete
  // action or explicitly say "none" — it can no longer just talk its way
  // out of using it. Best-effort: any failure here silently falls back to
  // the normal text-only reply the user already has.
  //
  // Also skipped whenever the main turn already made ANY real tool call
  // (toolCallLog.length > 0) — not just perform_ui_action. Live-tested bug
  // (2026-07-21): asking M.E.T.R.I.C. to summarize an uploaded document
  // correctly delegated via delegate_to_agent and got a real answer, but
  // this classifier still ran afterward (it only checked `!uiAction`),
  // got the bare user text with no conversation context, misclassified a
  // content question as a UI command, and overwrote the correct answer
  // with a random screen-navigation action. The classifier's whole
  // purpose is catching "the model declared a tool but talked its way out
  // of using ANY of them" — if a tool already ran, that failure mode by
  // definition didn't happen, so re-classifying can only do harm here.
  //
  // Never runs for delegated sub-runs: their input is the parent's task
  // text, not a user utterance, and the tool wasn't even declared for
  // them. Classifying task text without context is exactly how delegated
  // Herald/Metric runs ended up with phantom open_dashboard entries
  // (their real answers overwritten by a navigation confirmation).
  //
  // Etap 3 (A9): klasyfikator to drugie płatne wywołanie modelu. Wołamy go
  // tylko wtedy, gdy wypowiedź w ogóle wygląda na polecenie dla interfejsu
  // (krótka, nie pytanie, pasuje do słownika komend) albo na prośbę o nowy
  // plik, którą klasyfikator potrafi zlecić przez queue_document_job.
  const queueDocumentJobEnabled = state.toolDeclarations.some(
    (d) => d.name === "queue_document_job",
  );
  const worthClassifying =
    looksLikeUiCommand(input) || (queueDocumentJobEnabled && looksLikeDocumentRequest(input));
  if (!isDelegatedRun && !state.uiAction && state.toolCallLog.length === 0 && worthClassifying) {
    // Model nie zwrócił NIC (nawet po powtórce pustej tury) — wtedy akcja UI
    // z klasyfikatora nie może udawać odpowiedzi. Mówimy wprost, że raportu
    // nie ma, i dopiero potem, co otwieramy.
    const mainReplyEmpty = !state.finalText.trim();
    await logEvent("info", AGENT_SLUGS.JARVIS, "classifier fallback: block entered", {
      run_id: runId,
    } as Json);

    const classifierResult = await runClassifierFallback({
      groqApiKey,
      input,
      model: state.model,
      apiKey,
      effectiveUiActionsWithNone,
      runId,
      supabase,
      userId,
      agentId: agent.id,
      queueDocumentJobEnabled,
      ledger: runLedger,
      logEvent,
    });
    meterUsage(state, classifierResult.usage, classifierResult.costUsd);
    if (classifierResult.toolCallLogEntry)
      state.toolCallLog.push(classifierResult.toolCallLogEntry);
    if (classifierResult.uiAction) {
      state.uiAction = classifierResult.uiAction;
      state.finalText = mainReplyEmpty
        ? `Nie udało mi się przygotować odpowiedzi — model jej nie zwrócił. Spróbuj zapytać jeszcze raz. Na razie: ${classifierResult.finalText!}`
        : classifierResult.finalText!;
    }
    if (classifierResult.documentJob) {
      state.documentJob = classifierResult.documentJob;
      state.finalText = classifierResult.finalText!;
    }
  }

  // Append captured file links to the user-facing reply by code, verbatim.
  // Top-level runs only: delegated sub-runs hand their attachments up
  // structurally instead (their output text is read by the parent model,
  // and a URL there would only tempt it into retyping the token).
  if (delegationDepth === 0 && state.attachments.length > 0) {
    const linkLines = state.attachments
      .filter((a) => !state.finalText.includes(a.url))
      .map((a) => `⬇ ${a.url}`);
    if (linkLines.length > 0) {
      state.finalText = `${state.finalText.trim()}\n\n${linkLines.join("\n")}`.trim();
    }
  }

  // ODPOWIEDŹ, KTÓRA JEST SAMĄ ZAPOWIEDZIĄ.
  //
  // Zaobserwowane na żywo: na pytanie „co się ostatnio popsuło" J.A.R.V.I.S.
  // odpisał „zaraz sprawdzę, zlecam S.H.I.E.L.D. przeszukanie logów" i na tym
  // skończył turę. Delegacja nigdy nie ruszyła — pętla bierze tekst modelu
  // jako odpowiedź WYŁĄCZNIE wtedy, gdy w tej turze nie padło żadne wywołanie
  // narzędzia, więc ta wiadomość dowodzi, że narzędzia nie było.
  //
  // Nie da się tego naprawić w runtime bez zgadywania, czy zdanie jest
  // obietnicą — to zadanie dla promptu (zakaz pustych zapowiedzi wyżej).
  // Można za to sprawić, żeby powtórka nie była niewidzialna: agent, który
  // MÓGŁ delegować i nie sięgnął po żadne narzędzie, zostawia ślad razem z
  // pytaniem, które go do tego doprowadziło.
  if (
    !isDelegatedRun &&
    state.toolCallLog.length === 0 &&
    !state.uiAction &&
    state.toolDeclarations.some((d) => d.name === "delegate_to_agent")
  ) {
    await logEvent(
      "info",
      agent.slug,
      "odpowiedź bez ani jednego wywołania narzędzia, mimo dostępnej delegacji",
      { run_id: runId, input: input.slice(0, 200), reply: state.finalText.slice(0, 200) } as Json,
    );
  }

  // PRZEBIEG ZAKOŃCZONY BEZ ANI JEDNEGO ZNAKU ODPOWIEDZI.
  //
  // Czat renderował to jako „⚠ Agent error: unknown": status był „done",
  // więc żaden komunikat błędu nie powstał, a pusty tekst wpadał w gałąź
  // błędu po stronie UI. Użytkownik dostawał słowo „unknown", z którego nie
  // da się wywnioskować niczego — a przyczyna bywa bardzo konkretna: model
  // wywołał narzędzie, dostał wynik i nie napisał po nim nic.
  //
  // Zaobserwowane na żywo po dołożeniu narzędzia market_outlook. Zamiast
  // zostawiać puste miejsce, mówimy użytkownikowi prawdę i zapisujemy w
  // logu to, co rozstrzyga diagnozę: ile tur, jakie narzędzia.
  if (!state.finalText.trim()) {
    await logEvent(
      "warn",
      agent.slug,
      `przebieg zakończony bez treści odpowiedzi po ${state.toolCallLog.length} wywołaniach narzędzi`,
      {
        run_id: runId,
        tools: state.toolCallLog.map((c) => (c as { name?: string }).name ?? "?"),
      } as Json,
    );
    state.finalText =
      state.toolCallLog.length > 0
        ? "Pobrałem dane, ale nie udało mi się złożyć z nich odpowiedzi. Spróbuj zapytać jeszcze raz — jeśli powtórzy się, zajrzyj do logów systemowych."
        : "Nie udało mi się sformułować odpowiedzi. Spróbuj przeformułować pytanie.";
  }

  const latencyMs = Date.now() - startedAt;

  await supabase
    .from("agent_runs")
    .update({
      status: "done",
      output: { text: state.finalText, tool_calls: state.toolCallLog } as Json,
      model: state.model,
      // Koszt liczony TERAZ, po dzisiejszym cenniku, i zapisany przy
      // przebiegu — historia ma zostać tym, czym była, nawet gdy stawki
      // się zmienią. Suma wywołań, każde po swoim modelu (A20).
      ...runUsageColumns(state),
      latency_ms: latencyMs,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  await supabase
    .from("agents")
    .update({
      status: "idle",
      current_task: null,
      progress: 0,
      time_elapsed_seconds: Math.round(latencyMs / 1000),
      busy_since: null,
    })
    .eq("id", agent.id);

  await logEvent(
    "info",
    AGENT_SLUGS.JARVIS,
    `run done · ${state.toolCallLog.length} tool calls · ${latencyMs}ms`,
    {
      run_id: runId,
      tokens_in: state.usage.input,
      tokens_out: state.usage.output + state.usage.thinking,
    } as Json,
  );

  // Persist the visible turn (user message + final reply) so any device
  // logged into the same account sees the same conversation. Only for
  // top-level calls — delegated sub-runs don't own a conversation row.
  if (ctx.conversationId) {
    const { error: messagesErr } = await supabase.from("messages").insert([
      {
        user_id: userId,
        conversation_id: ctx.conversationId,
        run_id: runId,
        role: "user",
        content: input,
      },
      {
        user_id: userId,
        conversation_id: ctx.conversationId,
        run_id: runId,
        role: "jarvis",
        content: state.finalText || " ",
      },
    ]);
    if (messagesErr) {
      // Was previously unchecked — a failed insert here left the reply
      // visible in the client's chat bus but nothing in the DB, so the
      // turn silently vanished on the next getActiveConversation refetch
      // (e.g. navigating away from /jarvis and back). Log it instead of
      // swallowing it so a recurrence is diagnosable from System Logs.
      await logEvent(
        "error",
        AGENT_SLUGS.JARVIS,
        `message persist failed: ${messagesErr.message}`,
        {
          run_id: runId,
          conversation_id: ctx.conversationId,
        } as Json,
      );
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", ctx.conversationId);
  }

  return {
    runId,
    status: "done",
    output: state.finalText,
    action: state.uiAction ?? undefined,
    conversationId: ctx.conversationId,
    tokensIn: state.usage.input || undefined,
    tokensOut: state.usage.output + state.usage.thinking || undefined,
    latencyMs,
    attachments: state.attachments.length > 0 ? state.attachments : undefined,
    openDocument: state.openDocument ?? undefined,
    enrichDocument: state.enrichDocument ?? undefined,
    documentJob: state.documentJob ?? undefined,
    untrustedContent: state.untrustedSeen || undefined,
  };
}

export async function failRun(
  ctx: RunContext,
  state: RunState,
  err: unknown,
): Promise<AgentRunResult> {
  const { supabase, agent, runId, startedAt, logEvent } = ctx;
  const msg = err instanceof Error ? err.message : String(err);
  await supabase
    .from("agent_runs")
    .update({
      status: "error",
      error: msg,
      finished_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      // A4: zużycie do chwili awarii też jest rachunkiem.
      model: state.model,
      ...runUsageColumns(state),
    })
    .eq("id", runId);
  await supabase
    .from("agents")
    .update({
      status: "error",
      current_task: msg.slice(0, 200),
      progress: 0,
      time_elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
      busy_since: null,
    })
    .eq("id", agent.id);
  await logEvent("error", AGENT_SLUGS.JARVIS, `run failed: ${msg}`, { run_id: runId } as Json);
  return { runId, status: "error", output: "", error: msg };
}
