import { describe, expect, it } from "vitest";
import {
  budgetState,
  createModelBudget,
  DAILY_TOKEN_BUDGET,
  denyReason,
  warsawDay,
} from "./budget";
import { makeDb } from "@/lib/agents/runtime.testkit";

describe("budżet tokenów", () => {
  it("doba liczona w Warszawie", () => {
    expect(warsawDay(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
    expect(warsawDay(new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-01");
  });

  it("wpuszcza w limicie, odmawia ponad dzienny budżet i ponad pułap celu", () => {
    const s = budgetState(
      [
        { purpose: "forecast", tokens_in: 3_000, tokens_out: 1_000 },
        { purpose: "news", tokens_in: 3_500, tokens_out: 400 },
      ],
      "2026-11-01",
    );
    expect(s.used).toBe(7_900);
    expect(denyReason(s, "forecast", 2_500)).toBeNull();
    expect(denyReason(s, "forecast", 4_500)).toContain("pułap");
    expect(denyReason(s, "news", 3_200)).toContain("pułap");
    const full = budgetState(
      [{ purpose: "alarm", tokens_in: DAILY_TOKEN_BUDGET - 100, tokens_out: 0 }],
      "d",
    );
    expect(denyReason(full, "forecast", 200)).toContain("budżet dzienny");
  });
});

// Etap 2: moduł rynków pisze równolegle do księgi llm_usage.
describe("createModelBudget — księga llm_usage", () => {
  it("podaje kontekst księgi z modułem markets i celem budżetu", async () => {
    const { db } = makeDb(() => undefined);
    const budget = createModelBudget(db, "owner-1");
    expect(budget.ledger?.("forecast")).toMatchObject({
      db,
      ownerId: "owner-1",
      module: "markets",
      purpose: "forecast",
    });
  });
});
