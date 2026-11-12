import { describe, it, expect, vi, afterEach } from "vitest";
import { runAgentLoop } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { DEFAULT_GEMINI_MODEL } from "./models";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  geminiText,
  json,
  loggedMessages,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// Etap 6b (Rejestr, etap 2): agent z modelem, którego dostawca już nie
// serwuje (np. gemini-2.0-flash), dostawał 404 i — bez klucza Groq — run
// padał. Ma zejść na model domyślny z ostrzeżeniem w logu.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("model wyłączony u dostawcy", () => {
  it("404 na modelu agenta → model domyślny i ostrzeżenie, run kończy się odpowiedzią", async () => {
    const fetchMock = providerFetch({
      gemini: [
        json(404, { error: { message: "models/gemini-2.0-flash is not found" } }),
        geminiText("Działa."),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [{ ...HERALD, model: "gemini-2.0-flash" }],
      secrets: KEYS_GEMINI_ONLY,
    });

    const result = await runAgentLoop({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Cześć",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Działa.");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("gemini-2.0-flash");
    expect(urls[1]).toContain(DEFAULT_GEMINI_MODEL);
    expect(
      loggedMessages(calls).some((m) =>
        m.includes(`model gemini-2.0-flash niedostępny u dostawcy`),
      ),
    ).toBe(true);
  });
});
