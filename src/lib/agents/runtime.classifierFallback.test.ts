import { describe, it, expect, vi, afterEach } from "vitest";
import { runClassifierFallback } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

// Regression test for the extraction of runClassifierFallback out of
// runOrchestrator (previously two near-identical Groq/Gemini blocks inline).
// Pins down the side effects the refactor must not alter: which endpoint is
// hit, forceToolName/toolConfig reaching the request, logEvent's exact
// arguments per branch, and — critically — that Groq's classifier tokens are
// NOT added to the run's totals while Gemini's ARE (a pre-existing asymmetry
// that must survive the refactor unchanged, not get "fixed").

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function groqResponse(action: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call_0",
                type: "function",
                function: { name: "perform_ui_action", arguments: JSON.stringify({ action }) },
              },
            ],
          },
        },
      ],
      // Groq DOES report usage — the helper must still discard it (asymmetry #1).
      usage: { prompt_tokens: 111, completion_tokens: 22 },
    }),
    text: async () => "",
  };
}

function geminiResponse(action: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: "perform_ui_action", args: { action } } }] },
        },
      ],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
    }),
    text: async () => "",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseDeps = {
  input: "otwórz pulpit",
  model: "gemini-test",
  apiKey: "gemini-key",
  effectiveUiActionsWithNone: ["open_dashboard", "none"],
  runId: "run-1",
};

describe("runClassifierFallback", () => {
  it("with a Groq key: calls Groq only, forces the tool via tool_choice, doesn't count tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqResponse("open_dashboard"));
    vi.stubGlobal("fetch", fetchMock);
    const logEvent = vi.fn().mockResolvedValue(undefined);

    const result = await runClassifierFallback({
      ...baseDeps,
      groqApiKey: "groq-key",
      logEvent,
    });

    expect(result.uiAction).toBe("open_dashboard");
    expect(result.finalText).toBe("Otwieram pulpit główny.");
    expect(result.toolCallLogEntry).toEqual({
      name: "perform_ui_action",
      args: { action: "open_dashboard", via: "classifier_fallback_groq" },
    });
    // Asymmetry #1: Groq's usage is ignored, never added to the run totals.
    expect(result.tokensInDelta).toBe(0);
    expect(result.tokensOutDelta).toBe(0);

    // Only the Groq endpoint was hit — Gemini must never run when Groq succeeds.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GROQ_ENDPOINT);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "perform_ui_action" },
    });
    expect(body.temperature).toBe(0.1);

    expect(logEvent).toHaveBeenCalledWith(
      "info",
      AGENT_SLUGS.JARVIS,
      "ui action via classifier fallback (groq): open_dashboard",
      { run_id: "run-1" },
    );
  });

  it("without a Groq key: goes straight to Gemini, forces the tool via toolConfig, and counts tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiResponse("open_dashboard"));
    vi.stubGlobal("fetch", fetchMock);
    const logEvent = vi.fn().mockResolvedValue(undefined);

    const result = await runClassifierFallback({
      ...baseDeps,
      groqApiKey: null,
      logEvent,
    });

    expect(result.uiAction).toBe("open_dashboard");
    expect(result.toolCallLogEntry).toEqual({
      name: "perform_ui_action",
      args: { action: "open_dashboard", via: "classifier_fallback" },
    });
    // Gemini's usage IS added to the run totals (unlike Groq's).
    expect(result.tokensInDelta).toBe(20);
    expect(result.tokensOutDelta).toBe(5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["perform_ui_action"] },
    });
    expect(body.generationConfig).toEqual({ temperature: 0.1, maxOutputTokens: 50 });

    expect(logEvent).toHaveBeenCalledWith(
      "info",
      AGENT_SLUGS.JARVIS,
      "ui action via classifier fallback: open_dashboard",
      { run_id: "run-1" },
    );
  });

  it("Groq key present but the Groq call throws: falls through to Gemini and still returns its result", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (url === GROQ_ENDPOINT) throw new Error("groq unreachable");
      return geminiResponse("none");
    });
    vi.stubGlobal("fetch", fetchMock);
    const logEvent = vi.fn().mockResolvedValue(undefined);

    const result = await runClassifierFallback({
      ...baseDeps,
      groqApiKey: "groq-key",
      logEvent,
    });

    expect(result.uiAction).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith(
      "warn",
      AGENT_SLUGS.JARVIS,
      "classifier groq failed, falling back: groq unreachable",
      { run_id: "run-1" },
    );
  });
});
