import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runOrchestrator } from "./runtime.server";

// Regression test for download-link delivery.
//
// Observed live (2026-07-22, first flagship-demo test): the producer persona
// was told to paste generate_document's download_url VERBATIM into its
// reply. An LLM retyping a ~300-char signed-URL token reliably introduces
// typos — the pptx link failed with InvalidJWT "signature verification
// failed". The runtime now captures the URL from the TOOL RESULT and
// appends it to the final reply by code; the model never retypes it.

type CannedResponse = { data: unknown; error: { message: string } | null };

const SIGNED_URL =
  "https://example.supabase.co/storage/v1/object/sign/generated/u/f/raport.pdf?token=SIGNED_TOKEN_THE_MODEL_MUST_NOT_RETYPE";

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
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "p" }, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: SIGNED_URL }, error: null }),
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

const MODEL_REPLY = "Gotowe — plik czeka na pobranie poniżej, Panie Sławiński.";

// 1st Gemini call: the model invokes generate_document; 2nd call: text reply.
function makeGeminiFetchMock() {
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    call += 1;
    return {
      ok: true,
      json: async () =>
        call === 1
          ? {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "generate_document",
                          args: {
                            format: "pdf",
                            title: "Raport",
                            sections: [{ heading: "Sekcja", content: "Treść." }],
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { candidates: [{ content: { parts: [{ text: MODEL_REPLY }] } }] },
      text: async () => "",
    };
  });
}

function baseResponses(): Record<string, CannedResponse[]> {
  return {
    agents: [
      {
        data: {
          id: "agent-producer",
          name: "Producer",
          slug: "producer",
          model: "gemini-test",
          config: {},
        },
        error: null,
      },
      { data: [], error: null },
    ],
    user_secrets: [{ data: { gemini_api_key: "test-key", groq_api_key: null }, error: null }],
    agent_runs: [{ data: { id: "run-under-test" }, error: null }],
    agent_tools: [{ data: [], error: null }],
    conversations: [{ data: { id: "conv-1" }, error: null }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOrchestrator — generate_document link delivery", () => {
  it("appends the signed URL from the TOOL RESULT to the final reply and returns it as an attachment", async () => {
    vi.stubGlobal("fetch", makeGeminiFetchMock());

    const result = await runOrchestrator({
      supabase: makeSupabaseStub(baseResponses()),
      userId: "user-1",
      agentSlug: "producer",
      input: "Zrób PDF z raportem.",
      history: [],
    });

    expect(result.status).toBe("done");
    // The model's own prose survives, with the verbatim URL appended below it.
    expect(result.output).toContain(MODEL_REPLY);
    expect(result.output).toContain(`⬇ ${SIGNED_URL}`);
    expect(result.attachments).toEqual([{ filename: "raport.pdf", url: SIGNED_URL }]);
  });
});
