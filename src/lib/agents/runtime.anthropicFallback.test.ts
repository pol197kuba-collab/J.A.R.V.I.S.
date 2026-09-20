import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runOrchestrator } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

// Regresja na realną sytuację właściciela instalacji: klucz Anthropic
// zapisany, ale konto bez środków (płatność odrzucana przez operatora), więc
// KAŻDE wywołanie Claude wraca błędem. Bez ścieżki awaryjnej agent ustawiony
// na Claude przewracał cały run, mimo że klucz Gemini jest w tej aplikacji
// obowiązkowy i działa.

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

function responsesForClaudeAgent(): Record<string, CannedResponse[]> {
  return {
    agents: [
      {
        data: {
          id: "a-orch",
          name: "J.A.R.V.I.S.",
          slug: AGENT_SLUGS.JARVIS,
          // Agent ustawiony na Claude — dokładnie to robi przycisk
          // „Zastosuj rekomendowany podział" w Ustawieniach.
          model: "anthropic:claude-opus-5",
          config: {},
        },
        error: null,
      },
      { data: [], error: null },
    ],
    // Klucz Anthropic JEST, Groq nie ma. Bez przełączenia na Gemini run
    // nie miałby żadnej drogi wyjścia.
    user_secrets: [
      {
        data: {
          gemini_api_key: "gem-key",
          groq_api_key: null,
          anthropic_api_key: "sk-bez-srodkow",
        },
        error: null,
      },
    ],
    agent_runs: [{ data: { id: "run-1" }, error: null }],
    agent_tools: [{ data: [], error: null }],
    conversations: [{ data: { id: "conv-1" }, error: null }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOrchestrator — Claude niedostępny, run schodzi na Gemini", () => {
  it("kończy run na Gemini, gdy Claude odrzuca każde wywołanie", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("api.anthropic.com")) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            '{"type":"error","error":{"type":"invalid_request_error","message":"credit balance is too low"}}',
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
      supabase: makeSupabaseStub(responsesForClaudeAgent()),
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      input: "Cześć",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toContain("Gotowe.");

    const targets = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(targets.some((u) => u.includes("api.anthropic.com"))).toBe(true);
    expect(targets.some((u) => u.includes("generativelanguage.googleapis.com"))).toBe(true);
  });

  it("nie zapętla się, gdy Gemini też pada", async () => {
    // Przełączenie providera jest jednorazowe — po nim tura leci zwykłą
    // ścieżką Gemini i jej błąd kończy run, zamiast wracać do Claude.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runOrchestrator({
      supabase: makeSupabaseStub(responsesForClaudeAgent()),
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      input: "Cześć",
      history: [],
    });

    expect(result.status).toBe("error");
  });
});
