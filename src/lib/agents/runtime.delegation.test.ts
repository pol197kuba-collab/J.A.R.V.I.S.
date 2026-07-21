import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runOrchestrator } from "./runtime.server";

// Regression tests for UI control leaking into delegated sub-runs.
//
// Observed live (2026-07-21, screenshots of Marketer/Analityk run history):
// delegated runs answered with plain text, which triggered the fallback
// UI-action classifier on the bare task text; misclassifications logged
// phantom "perform_ui_action: open_dashboard" entries and overwrote the
// delegate's real answer with a navigation confirmation. Delegated runs
// never face the user, so they must get no perform_ui_action declaration,
// no "DOSTĘP DO INTERFEJSU" prompt block, and no classifier pass.

type CannedResponse = { data: unknown; error: { message: string } | null };

// Minimal thenable stand-in for the supabase-js query builder: every chained
// method (.select/.eq/.insert/.single/...) returns the same proxy, and
// awaiting it anywhere in the chain resolves to the canned response for that
// `.from(table)` call. Responses are consumed per table in order; the last
// one repeats (covers repeated event-log inserts and run updates).
function makeSupabaseStub(responses: Record<string, CannedResponse[]>) {
  const counts: Record<string, number> = {};
  return {
    from(table: string) {
      const list = responses[table] ?? [{ data: null, error: null }];
      const idx = Math.min(counts[table] ?? 0, list.length - 1);
      counts[table] = (counts[table] ?? 0) + 1;
      const resp = list[idx];
      const chain: Record<string | symbol, unknown> = {};
      const proxy: unknown = new Proxy(chain, {
        get(_target, prop) {
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
}

const MODEL_REPLY = "Szkic kampanii gotowy, Panie Sławiński.";

function makeGeminiFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: MODEL_REPLY }] } }],
    }),
    text: async () => "",
  });
}

function baseResponses(): Record<string, CannedResponse[]> {
  return {
    agents: [
      // 1st call: the agent being run.
      {
        data: {
          id: "agent-marketer",
          name: "Marketer",
          slug: "marketer",
          model: "gemini-test",
          config: {},
        },
        error: null,
      },
      // 2nd call: team roster.
      { data: [], error: null },
    ],
    // groq_api_key deliberately null so a classifier pass, if (wrongly)
    // entered, must go through the Gemini path — i.e. a second fetch call,
    // which the assertions below count.
    user_secrets: [{ data: { gemini_api_key: "test-key", groq_api_key: null }, error: null }],
    agent_runs: [{ data: { id: "run-under-test" }, error: null }],
    agent_tools: [{ data: [], error: null }],
    conversations: [{ data: { id: "conv-1" }, error: null }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOrchestrator — delegated sub-runs get no UI control", () => {
  it("delegated run: no perform_ui_action declaration, no UI prompt block, no classifier pass", async () => {
    const fetchMock = makeGeminiFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOrchestrator({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "user-1",
      agentSlug: "marketer",
      input: "Przygotuj tekst kampanii dla pulpitu klienta.",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    // The delegate's real answer survives untouched...
    expect(result.status).toBe("done");
    expect(result.output).toBe(MODEL_REPLY);

    // ...after exactly ONE model call: a text-only reply must NOT trigger
    // the fallback classifier (that second call is precisely the regression).
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.stringify(body)).not.toContain("perform_ui_action");
    const systemText = body.systemInstruction.parts[0].text as string;
    expect(systemText).not.toContain("DOSTĘP DO INTERFEJSU");
  });

  it("top-level run keeps UI control: tool declared, prompt block present, classifier still runs", async () => {
    const fetchMock = makeGeminiFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOrchestrator({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "user-1",
      agentSlug: "marketer",
      input: "Przygotuj tekst kampanii dla pulpitu klienta.",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe(MODEL_REPLY);

    // Main turn + classifier fallback (text-only reply, zero tool calls).
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.stringify(body)).toContain("perform_ui_action");
    const systemText = body.systemInstruction.parts[0].text as string;
    expect(systemText).toContain("DOSTĘP DO INTERFEJSU");
  });
});
