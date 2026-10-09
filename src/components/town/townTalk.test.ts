import { describe, expect, it } from "vitest";
import type { FlowRun } from "@/lib/agents/flow.functions";
import { accepted, lastResultLine, statusLine } from "./townTalk";

const now = Date.parse("2026-10-09T09:00:30.000Z");
const run = (p: Partial<FlowRun> & Pick<FlowRun, "id" | "agentSlug">): FlowRun => ({
  agentName: p.agentSlug,
  parentRunId: null,
  status: "done",
  toolCalls: [],
  delegations: [],
  latencyMs: null,
  createdAt: "2026-10-09T09:00:00.000Z",
  finishedAt: "2026-10-09T09:00:12.000Z",
  ...p,
});
const parent = run({
  id: "p",
  agentSlug: "jarvis",
  delegations: [{ toSlug: "insight", task: "Zbierz prognozy cen paliw" }],
});

describe("statusLine (Jak idzie?)", () => {
  it("describes live work with the delegated task, last step and elapsed time", () => {
    const live = run({
      id: "c",
      agentSlug: "insight",
      parentRunId: "p",
      status: "running",
      finishedAt: null,
      toolCalls: [{ name: "web_search", args: {} }],
    });
    const line = statusLine("insight", [parent, live], null, true, now);
    expect(line).toContain("„Zbierz prognozy cen paliw”");
    expect(line).toContain("web_search");
    expect(line).toContain("30 s");
  });
  it("says it is free and what it last did", () => {
    const done = run({ id: "c", agentSlug: "insight", parentRunId: "p" });
    expect(statusLine("insight", [parent, done], null, true, now)).toMatch(/Mam wolne.*„Zbierz prognozy cen paliw” \(12 s\)/);
  });
  it("uses feminine verb forms for H.E.R.A.L.D.", () => {
    expect(statusLine("herald", [], null, true, now)).toContain("nie robiłam");
    expect(statusLine("herald", [], null, false, now)).toContain("wyłączona");
    expect(accepted("herald")).toBe("Przyjęłam!");
    expect(accepted("forge")).toBe("Przyjąłem!");
  });
  it("is honest about an error", () => {
    const failed = run({ id: "c", agentSlug: "insight", parentRunId: "p", status: "error" });
    expect(statusLine("insight", [parent, failed], null, true, now)).toContain("nie wyszło");
  });
});

describe("lastResultLine (Pokaż ostatni wynik)", () => {
  it("lets J.A.R.V.I.S. quote his latest chat reply", () => {
    expect(lastResultLine("jarvis", [], "Raport gotowy.", now)).toBe("Raport gotowy.");
  });
  it("summarises an agent's last finished run with its steps", () => {
    const done = run({
      id: "c",
      agentSlug: "insight",
      parentRunId: "p",
      toolCalls: [{ name: "web_search", args: {} }, { name: "fetch_url", args: {} }],
    });
    const line = lastResultLine("insight", [parent, done], null, now);
    expect(line).toContain("gotowe w 12 s");
    expect(line).toContain("web_search, fetch_url");
  });
  it("admits when there is nothing yet", () => {
    expect(lastResultLine("metric", [], null, now)).toMatch(/Nie mam jeszcze/);
  });
});
