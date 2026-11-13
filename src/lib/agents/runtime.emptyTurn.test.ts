import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runAgentLoop } from "./runtime.server";
import { callGroq, chooseGroqModel } from "@/lib/ai/llm/groq";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { testSecretsDb } from "@/test/secretsDb";

// Live failure (2026-10-09): with Claude out of credits the run fell back to
// gemini-2.5-flash, which returned an EMPTY turn (no text, no function call,
// finishReason=STOP). The loop took that as the end of the turn and the UI
// classifier replaced the missing answer with "Otwieram dziennik systemu."
// — the user asked what broke and got a screen change instead of a report.
// Meanwhile every classifier pass 404'd on a Groq model Groq had retired.

type CannedResponse = { data: unknown; error: { message: string } | null };

function makeSupabaseStub(responses: Record<string, CannedResponse[]>) {
  const counts: Record<string, number> = {};
  const stub = {
    from(table: string) {
      const list = responses[table] ?? [{ data: null, error: null }];
      const idx = Math.min(counts[table] ?? 0, list.length - 1);
      counts[table] = (counts[table] ?? 0) + 1;
      const resp = list[idx];
      const chain: Record<string | symbol, unknown> = {};
      const proxy: unknown = new Proxy(chain, {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: CannedResponse) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(resp).then(resolve, reject);
          }
          return () => proxy;
        },
      });
      return proxy;
    },
  } as unknown as SupabaseClient<Database>;
  // Etap 5 (A5): user_secrets czyta klient service role — w testach ta sama atrapa.
  testSecretsDb.current = stub;
  return stub;
}

function baseResponses(): Record<string, CannedResponse[]> {
  return {
    agents: [
      {
        data: {
          id: "a-orch",
          name: "J.A.R.V.I.S.",
          slug: AGENT_SLUGS.JARVIS,
          model: "gemini-2.5-flash",
          config: {},
        },
        error: null,
      },
      { data: [], error: null },
    ],
    // No Groq key: if the retry DIDN'T work, the run would hard-fail here
    // (no failover), so a "done" status proves the retry recovered it.
    user_secrets: [{ data: { gemini_api_key: "test-key", groq_api_key: null }, error: null }],
    agent_runs: [{ data: { id: "run-1" }, error: null }],
    agent_tools: [{ data: [], error: null }],
    conversations: [{ data: { id: "conv-1" }, error: null }],
  };
}

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => "",
  json: async () => body,
});
const emptyTurn = ok({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] });
const textTurn = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] } }] });
const geminiCalls = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter(([url]) => String(url).includes(":generateContent"));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAgentLoop — empty Gemini turn", () => {
  it("retries an empty turn once, without thinking, and returns the real answer", async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      n += 1;
      if (n === 1) return emptyTurn;
      if (n === 2) return textTurn("Ostatni błąd: timeout w market-grid o 03:12.");
      // the UI classifier pass that follows a text-only turn
      return ok({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "perform_ui_action", args: { action: "none" } } }],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgentLoop({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      input: "co się ostatnio wywaliło?",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toContain("timeout w market-grid");
    const calls = geminiCalls(fetchMock);
    expect(bodyOf(calls[0]).generationConfig.thinkingConfig).toBeUndefined();
    expect(bodyOf(calls[1]).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("when the model stays silent, a UI action never pretends to be the answer", async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      n += 1;
      if (n <= 2) return emptyTurn;
      return ok({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "perform_ui_action", args: { action: "open_logs" } } },
              ],
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgentLoop({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      // Etap 3: klasyfikator rusza tylko dla wypowiedzi wyglądających na
      // polecenie UI — tu polecenie, na które model nic nie odpowiedział.
      input: "pokaż logi",
      history: [],
    });

    expect(result.output).toMatch(/^Nie udało mi się przygotować odpowiedzi/);
    expect(result.output).toContain("Otwieram dziennik systemu.");
  });

  it("pytanie, na które model milczy: bez klasyfikatora, bez fałszywej akcji UI (etap 3)", async () => {
    // Oryginalny błąd z 2026-10-09: na „co się ostatnio wywaliło?” klasyfikator
    // dokładał „Otwieram dziennik systemu.” Pytanie nie trafia już do niego.
    const fetchMock = vi.fn().mockResolvedValue(emptyTurn);
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgentLoop({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      input: "co się ostatnio wywaliło?",
      history: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // tura + jedna powtórka pustej tury
    expect(result.action).toBeUndefined();
    expect(result.output).not.toContain("Otwieram");
  });
});

describe("Groq — retired model", () => {
  it("picks a small chat model as a stand-in and skips non-chat models", () => {
    const available = [
      "whisper-large-v3",
      "llama-guard-4-12b",
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-20b",
    ];
    expect(chooseGroqModel(available, "llama-3.1-8b-instant")).toBe("openai/gpt-oss-20b");
    // Etap 6b: GPT-OSS ma pierwszeństwo przed „instant” (Llama na Groq to
    // dziś „Enterprise / Contact Sales”).
    expect(chooseGroqModel(["x-instant", ...available], "llama-3.1-8b-instant")).toBe(
      "openai/gpt-oss-20b",
    );
    expect(chooseGroqModel(["x-instant", "whisper-large-v3"], "gone")).toBe("x-instant");
    expect(chooseGroqModel(available, "llama-3.3-70b-versatile")).toBe("llama-3.3-70b-versatile");
    expect(chooseGroqModel(["whisper-large-v3"], "gone")).toBeNull();
  });

  it("swaps a model_not_found for an available one and remembers it", async () => {
    const reply = ok({ choices: [{ message: { content: "ok" } }], usage: {} });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () =>
          '{"error":{"message":"The model `retired-8b` does not exist","code":"model_not_found"}}',
        json: async () => ({}),
      })
      .mockResolvedValueOnce(ok({ data: [{ id: "llama-3.3-70b-versatile", active: true }] }))
      .mockResolvedValue(reply);
    vi.stubGlobal("fetch", fetchMock);
    const opts = { apiKey: "k", model: "retired-8b", systemPrompt: "s", contents: [] };

    expect((await callGroq(opts)).text).toBe("ok");
    expect(bodyOf(fetchMock.mock.calls[2]).model).toBe("llama-3.3-70b-versatile");
    await callGroq(opts);
    // second call goes straight to the stand-in — no 404, no model listing
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(bodyOf(fetchMock.mock.calls[3]).model).toBe("llama-3.3-70b-versatile");
  });
});

describe("Groq — modele myślące (etap 6b)", () => {
  it("gpt-oss: reasoning_effort low i zapas tokenów na myślenie; Llama bez zmian", async () => {
    const { groqReasoningParams, REASONING_TOKEN_HEADROOM } = await import("@/lib/ai/llm/groq");
    expect(groqReasoningParams("openai/gpt-oss-20b", 50)).toEqual({
      reasoning_effort: "low",
      max_tokens: 50 + REASONING_TOKEN_HEADROOM,
    });
    expect(groqReasoningParams("openai/gpt-oss-120b", undefined)).toEqual({
      reasoning_effort: "low",
    });
    expect(groqReasoningParams("llama-3.3-70b-versatile", 50)).toEqual({ max_tokens: 50 });
  });
});
