import { describe, it, expect, vi, afterEach } from "vitest";
import { runAgentLoop } from "./runtime.server";
import { getToolByName } from "./tools.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { acceptsForcedToolChoice } from "@/lib/ai/llm/anthropic";
import {
  FORGE,
  geminiCall,
  geminiText,
  isAnthropic,
  loggedMessages,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// Etap 6b (Rejestr, etap 3): Claude Opus 5.5 / Sonnet 5.5 (i Fable 5.1/5.2)
// odrzucają wymuszenie narzędzia (tool_choice "tool"/"any") błędem 400 —
// sprawdzone w dokumentacji Claude API 2026-11-12. F.O.R.G.E. na tych modelach
// padał na każdej pierwszej turze i schodził na Gemini przez failover (warn).
// Teraz wymuszona tura generate_document od razu idzie na Gemini, z jednym info.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("acceptsForcedToolChoice", () => {
  it("modele odrzucające wymuszenie", () => {
    for (const m of [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-fable-5-1",
      "claude-fable-5-2",
      "claude-mythos-5-2",
    ]) {
      expect(acceptsForcedToolChoice(m), m).toBe(false);
    }
  });

  it("modele, które wymuszenie przyjmują", () => {
    for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-5-5"]) {
      expect(acceptsForcedToolChoice(m), m).toBe(true);
    }
  });
});

describe("F.O.R.G.E. na modelu bez wymuszenia narzędzia", () => {
  it("wymuszona tura od razu na Gemini — bez wywołania Claude, bez ostrzeżenia", async () => {
    vi.spyOn(getToolByName("generate_document")!, "execute").mockResolvedValue({
      ok: true,
      filename: "raport.docx",
      download_url: "https://example.test/raport.docx",
    });
    const fetchMock = providerFetch({
      gemini: [geminiCall("generate_document", { title: "Raport" }), geminiText("Plik gotowy.")],
      anthropic: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [{ ...FORGE, model: "anthropic:claude-opus-5-5" }],
      secrets: { gemini_api_key: "gem", groq_api_key: null, anthropic_api_key: "ant" },
    });

    const result = await runAgentLoop({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.FORGE,
      input: "Zrób raport",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(fetchMock.mock.calls.some((c) => isAnthropic(c[0]))).toBe(false);
    const logs = loggedMessages(calls);
    expect(logs.some((m) => m.includes("nie przyjmuje wymuszenia narzędzia"))).toBe(true);
    expect(logs.some((m) => m.includes("nie odpowiedział"))).toBe(false);
  });
});
