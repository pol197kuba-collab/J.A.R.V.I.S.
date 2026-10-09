import { describe, expect, it } from "vitest";
import type { FlowRun } from "@/lib/agents/flow.functions";
import type { AppNotification } from "@/lib/notifications/notifications.functions";
import {
  errorKind,
  explainError,
  failedRunOf,
  nightLevel,
  providerOf,
  providerTrouble,
  retryPlan,
  visitReport,
} from "./townInsights";

const T0 = Date.parse("2026-10-09T10:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const run = (o: Partial<FlowRun> & { id: string; agentSlug: string }): FlowRun => ({
  agentName: o.agentSlug,
  parentRunId: null,
  status: "done",
  toolCalls: [],
  delegations: [],
  latencyMs: null,
  createdAt: iso(0),
  finishedAt: iso(1),
  ...o,
});
const name = (s: string) => s.toUpperCase();

describe("errors", () => {
  it("classifies provider messages", () => {
    expect(errorKind("Anthropic 400: Your credit balance is too low")).toBe("credits");
    expect(errorKind("429 Too Many Requests")).toBe("rate");
    expect(errorKind("Gemini 401: API key not valid")).toBe("auth");
    expect(errorKind("Request timed out after 60s")).toBe("timeout");
    expect(errorKind("TypeError: fetch failed")).toBe("network");
    expect(errorKind("something odd")).toBe("other");
    expect(providerOf("claude-sonnet-5-5")).toBe("Anthropic");
    expect(providerOf("gemini-2.5-flash")).toBe("Gemini");
    expect(providerOf(null)).toBeNull();
  });

  it("explains in plain words and keeps the original message", () => {
    const t = explainError("Anthropic API error: credit balance is too low");
    expect(t).toMatch(/Brak środków.*\(Anthropic\)/);
    expect(t).toContain("Komunikat: Anthropic API error");
  });

  it("finds an agent's failed newest run, and only the newest", () => {
    const runs = [
      run({ id: "a", agentSlug: "insight", status: "error", createdAt: iso(0) }),
      run({ id: "b", agentSlug: "insight", status: "done", createdAt: iso(5) }),
      run({ id: "c", agentSlug: "metric", status: "error", createdAt: iso(3) }),
    ];
    expect(failedRunOf("insight", runs)).toBeNull();
    expect(failedRunOf("metric", runs)?.id).toBe("c");
  });

  it("retries with the same words to the same agent", () => {
    const parent = run({
      id: "p",
      agentSlug: "jarvis",
      inputText: "Sprawdź paliwa",
      delegations: [{ toSlug: "insight", task: "Zbierz ceny paliw" }],
    });
    const child = run({ id: "c", agentSlug: "insight", parentRunId: "p", status: "error" });
    expect(retryPlan(child, [parent, child])).toEqual({ text: "Zbierz ceny paliw", to: "insight" });
    expect(retryPlan({ ...parent, status: "error" }, [parent])).toEqual({
      text: "Sprawdź paliwa",
      to: "auto",
    });
    expect(retryPlan(run({ id: "x", agentSlug: "jarvis" }), [])).toBeNull();
  });
});

describe("providerTrouble", () => {
  const now = T0 + 60 * 60_000;
  it("raises the alarm for a recent credits error", () => {
    const t = providerTrouble(
      [
        run({
          id: "e",
          agentSlug: "jarvis",
          status: "error",
          error: "Anthropic: credit balance too low",
        }),
      ],
      now,
    );
    expect(t).toMatchObject({ provider: "Anthropic", kind: "credits" });
  });
  it("clears once that provider answers again", () => {
    const runs = [
      run({
        id: "e",
        agentSlug: "jarvis",
        status: "error",
        error: "Anthropic: credit balance too low",
      }),
      run({ id: "g", agentSlug: "jarvis", createdAt: iso(10), model: "gemini-2.5-flash" }),
    ];
    expect(providerTrouble(runs, now)).not.toBeNull();
    runs.push(
      run({ id: "a", agentSlug: "insight", createdAt: iso(20), model: "claude-sonnet-5-5" }),
    );
    expect(providerTrouble(runs, now)).toBeNull();
  });
  it("ignores ordinary failures and old ones", () => {
    expect(
      providerTrouble([run({ id: "e", agentSlug: "jarvis", status: "error", error: "boom" })], now),
    ).toBeNull();
    expect(
      providerTrouble(
        [run({ id: "e", agentSlug: "jarvis", status: "error", error: "429 rate limit" })],
        now + 48 * 3600_000,
      ),
    ).toBeNull();
  });
});

describe("visitReport", () => {
  const note = (min: number, kind: string, title: string): AppNotification => ({
    id: title,
    kind,
    title,
    body: null,
    payload: {},
    read: false,
    createdAt: iso(min),
  });

  it("returns null when nothing happened", () => {
    expect(
      visitReport(
        [run({ id: "a", agentSlug: "jarvis", finishedAt: iso(1) })],
        [],
        T0 + 5 * 60_000,
        name,
      ),
    ).toBeNull();
  });

  it("summarises finished requests, the busiest agent and new notifications", () => {
    const since = T0;
    const lines = visitReport(
      [
        run({ id: "a", agentSlug: "jarvis", finishedAt: iso(5) }),
        run({ id: "b", agentSlug: "jarvis", finishedAt: iso(6), status: "error" }),
        run({ id: "c", agentSlug: "insight", parentRunId: "a", finishedAt: iso(4) }),
        run({ id: "old", agentSlug: "metric", createdAt: iso(-90), finishedAt: iso(-89) }),
      ],
      [
        note(7, "standing_order", "Raport paliw"),
        note(8, "standing_order", "Kurs EUR"),
        note(-5, "fuel_alert", "stare"),
      ],
      since,
      name,
    )!;
    expect(lines[0]).toBe("Polecenia: 1 zakończone, 1 z błędem.");
    expect(lines[1]).toBe("Najwięcej pracował(a): JARVIS (2).");
    expect(lines[2]).toBe("Powiadomienia: meldunki zadań cyklicznych — 2.");
    expect(lines[3]).toBe("Ostatnie: „Kurs EUR”.");
  });

  it("says 'co najmniej' when the feed doesn't reach back far enough", () => {
    const runs = Array.from({ length: 40 }, (_, i) =>
      run({ id: `r${i}`, agentSlug: "jarvis", createdAt: iso(i + 1), finishedAt: iso(i + 2) }),
    );
    expect(visitReport(runs, [], T0, name)![0]).toMatch(/co najmniej 40/);
  });
});

describe("nightLevel", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m);
  it("is day from 7 to 18, night from 21 to 5, with dusk and dawn between", () => {
    expect(nightLevel(at(12))).toBe(0);
    expect(nightLevel(at(23))).toBe(1);
    expect(nightLevel(at(3))).toBe(1);
    expect(nightLevel(at(19, 30))).toBeCloseTo(0.5);
    expect(nightLevel(at(6))).toBeCloseTo(0.5);
  });
});
