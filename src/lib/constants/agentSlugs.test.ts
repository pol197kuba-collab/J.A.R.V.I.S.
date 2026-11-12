import { describe, it, expect } from "vitest";
import { AGENT_SLUGS, isAgentSlug } from "./agentSlugs";

describe("isAgentSlug", () => {
  it("przyjmuje każdego istniejącego agenta", () => {
    for (const slug of Object.values(AGENT_SLUGS)) expect(isAgentSlug(slug)).toBe(true);
    expect(isAgentSlug("droid")).toBe(true);
  });

  it("odrzuca slug, którego nie ma (np. zapamiętany sprzed zmiany nazw)", () => {
    expect(isAgentSlug("orchestrator")).toBe(false);
    expect(isAgentSlug("")).toBe(false);
    expect(isAgentSlug(undefined)).toBe(false);
  });
});
