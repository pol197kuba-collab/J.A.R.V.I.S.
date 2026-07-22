import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runOrchestrator } from "./runtime.server";

// Regression test for the Gemini 503 "high demand" storm (observed live
// 2026-07-22: bursts of HTTP 503 broke every presentation run for minutes,
// because a single 503 immediately fell over to Groq, which 400s on our
// tool-calling shape). The runtime now retries the SAME Gemini request on
// transient statuses before failing over — so a 503 that clears on the
// next attempt yields a normal successful run.

type CannedResponse = { data: unknown; error: { message: string } | null };

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
}

function baseResponses(): Record<string, CannedResponse[]> {
  return {
    agents: [
      {
        data: {
          id: "a-orch",
          name: "Orchestrator",
          slug: "orchestrator",
          model: "gemini-test",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOrchestrator — Gemini 503 retry before failover", () => {
  it("retries a transient 503 and succeeds without a Groq key", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => '{"error":{"code":503,"status":"UNAVAILABLE"}}',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ candidates: [{ content: { parts: [{ text: "Gotowe." }] } }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOrchestrator({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "u1",
      agentSlug: "orchestrator",
      input: "Cześć",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toContain("Gotowe.");
    // First call 503, second call 200 — proves a retry happened.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
