import { describe, it, expect, vi, afterEach } from "vitest";
import { runOrchestrator } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  JARVIS,
  KEYS_GEMINI_ONLY,
  geminiBodies,
  geminiText,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// Prompt systemowy co do znaku (plan naprawczy, etap 4): przeniesienie
// promptu i bloku zespołu do osobnego pliku nie może zmienić treści.
// Snapshot powstał na kodzie sprzed przeniesienia.

afterEach(() => vi.unstubAllGlobals());

const SHIELD = {
  id: "agent-shield",
  name: "S.H.I.E.L.D.",
  slug: AGENT_SLUGS.SHIELD,
  model: "gemini-2.5-flash",
  config: {},
  role: "strażnik",
  description: "Pilnuje zdrowia systemu",
  is_enabled: true,
};

async function stablePrompt(
  agentSlug: string,
  agents: Parameters<typeof worldDb>[0]["agents"],
  delegated: boolean,
) {
  const fetchMock = providerFetch({ gemini: [geminiText("ok")] });
  vi.stubGlobal("fetch", fetchMock);
  const { db } = worldDb({ agents, secrets: KEYS_GEMINI_ONLY });
  await runOrchestrator({
    supabase: db,
    userId: "u1",
    agentSlug,
    input: "Hej",
    history: [],
    ...(delegated ? { delegationDepth: 1, parentRunId: "run-parent" } : {}),
  });
  const body = geminiBodies(fetchMock)[0];
  const parts = (body.systemInstruction as { parts: { text: string }[] }).parts;
  return { stable: parts[0].text, tools: JSON.stringify(body.tools ?? null) };
}

describe("prompt systemowy — bez zmian treści", () => {
  it("J.A.R.V.I.S. z zespołem (Herald, wyłączony Shield)", async () => {
    const got = await stablePrompt(
      AGENT_SLUGS.JARVIS,
      [JARVIS, HERALD, { ...SHIELD, is_enabled: false }],
      false,
    );
    expect(got.stable).toMatchSnapshot();
    expect(got.tools).toMatchSnapshot();
  });

  it("J.A.R.V.I.S. z włączonym Shieldem (bez system_check w enumie)", async () => {
    const got = await stablePrompt(AGENT_SLUGS.JARVIS, [JARVIS, HERALD, SHIELD], false);
    expect(got.tools).toMatchSnapshot();
  });

  it("agent z własnym promptem, run delegowany", async () => {
    const got = await stablePrompt(
      AGENT_SLUGS.HERALD,
      [JARVIS, { ...HERALD, config: { system_prompt: "Jesteś H.E.R.A.L.D., copywriter." } }],
      true,
    );
    expect(got.stable).toMatchSnapshot();
  });
});
