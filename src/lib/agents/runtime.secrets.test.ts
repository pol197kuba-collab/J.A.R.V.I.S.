import { describe, it, expect, vi, afterEach } from "vitest";
import { runOrchestrator } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  geminiText,
  makeDb,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// A5 (plan naprawczy, etap 5): klucze czyta serwer klientem service role,
// nie klientem użytkownika — po migracji rola `authenticated` nie ma dostępu
// do user_secrets.

afterEach(() => vi.unstubAllGlobals());

describe("runOrchestrator — klucze przez klienta sekretów", () => {
  it("klient użytkownika nie dotyka user_secrets", async () => {
    vi.stubGlobal("fetch", providerFetch({ gemini: [geminiText("ok")] }));
    // Świat użytkownika BEZ kluczy…
    const user = worldDb({
      agents: [HERALD],
      secrets: KEYS_GEMINI_ONLY,
      extra: (t) =>
        t === "user_secrets" ? { data: null, error: { message: "permission denied" } } : undefined,
    });
    // …a klucze tylko w bazie widzianej przez service role (utworzona jako ostatnia).
    const admin = makeDb((t) =>
      t === "user_secrets" ? { data: KEYS_GEMINI_ONLY, error: null } : undefined,
    );

    const result = await runOrchestrator({
      supabase: user.db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(user.calls.some((c) => c.table === "user_secrets")).toBe(false);
    expect(admin.calls.find((c) => c.table === "user_secrets")?.ops).toContainEqual({
      method: "eq",
      args: ["owner_id", "u1"],
    });
  });
});
