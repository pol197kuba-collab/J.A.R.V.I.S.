import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  geminiBodies,
  geminiText,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// Gemini 3.x/4.x (zgłoszenie 2026-11-13, przejście z wycofanego 2.5 Flash):
// podpis myślenia z wywołania narzędzia musi wrócić w następnej turze,
// a parametry próbkowania nie mogą trafić do zapytania.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const signedCall = {
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [
      {
        content: {
          parts: [{ functionCall: { name: "list_notes", args: {} }, thoughtSignature: "sig-123" }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
  }),
  text: async () => "",
};

describe("Gemini 3.x w pętli agenta", () => {
  it("odsyła thoughtSignature przy wywołaniu narzędzia i nie wysyła temperature", async () => {
    const fetchMock = providerFetch({
      gemini: [signedCall as never, geminiText("Masz 0 notatek.")],
    });
    vi.stubGlobal("fetch", fetchMock);
    const herald = { ...HERALD, model: "gemini-3.8-flash" };
    const { db } = worldDb({
      agents: [herald],
      secrets: KEYS_GEMINI_ONLY,
      toolSlugs: ["list_notes"],
    });

    const result = await runAgentLoop({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Ile mam notatek?",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });
    expect(result.status).toBe("done");

    const bodies = geminiBodies(fetchMock);
    const second = bodies[1].contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    const modelTurn = second.find((c) => c.role === "model")!;
    expect(modelTurn.parts[0]).toEqual({
      functionCall: { name: "list_notes", args: {} },
      thoughtSignature: "sig-123",
    });
    for (const b of bodies) {
      const gc = b.generationConfig as Record<string, unknown>;
      expect(gc).not.toHaveProperty("temperature");
    }
  });
});
