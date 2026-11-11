import { describe, expect, it } from "vitest";
import { budgetMessage, budgetStatus, chooseModel, summarizeSpend, WARN_AT } from "./budget";

describe("budgetStatus", () => {
  it("rozpoznaje trzy stany", () => {
    expect(budgetStatus(1, 5).level).toBe("ok");
    expect(budgetStatus(5 * WARN_AT, 5).level).toBe("warn");
    expect(budgetStatus(5, 5).level).toBe("over");
    expect(budgetStatus(9, 5).level).toBe("over");
  });

  it("limit zero znaczy „nie pilnuj”, a nie „zablokuj wszystko”", () => {
    // Dzielenie przez zero dałoby nieskończoność i natychmiastową degradację
    // wszystkiego — czyli odwrotność tego, co znaczy wyłączony limit.
    const status = budgetStatus(1000, 0);
    expect(status.level).toBe("ok");
    expect(status.ratio).toBe(0);
  });

  it("nie przyjmuje ujemnych wydatków", () => {
    expect(budgetStatus(-5, 5).spentUsd).toBe(0);
  });
});

describe("chooseModel", () => {
  const over = budgetStatus(10, 5);
  const warn = budgetStatus(4.5, 5);
  const ok = budgetStatus(1, 5);

  it("poniżej limitu nie rusza modelu", () => {
    expect(chooseModel("anthropic:claude-opus-5", ok)).toEqual({
      model: "anthropic:claude-opus-5",
      downgraded: false,
      requested: "anthropic:claude-opus-5",
    });
  });

  it("OSTRZEŻENIE też nie rusza modelu", () => {
    // Gdyby ruszało, próg 80% byłby faktycznym limitem, a liczba w
    // ustawieniach nie znaczyłaby tego, co mówi.
    expect(chooseModel("anthropic:claude-opus-5", warn).downgraded).toBe(false);
  });

  it("po przekroczeniu schodzi JEDEN stopień, nie od razu na dno", () => {
    expect(chooseModel("anthropic:claude-opus-5", over)).toEqual({
      model: "anthropic:claude-sonnet-5",
      downgraded: true,
      requested: "anthropic:claude-opus-5",
    });
    expect(chooseModel("anthropic:claude-sonnet-5", over).model).toBe("anthropic:claude-haiku-4-5");
  });

  it("najtańszy model zostaje jak jest — nie ma dokąd schodzić", () => {
    // Odmowa pracy nie jest tu opcją; brak tańszego wariantu znaczy
    // „pracuj dalej", a nie „stój".
    const decision = chooseModel("gemini-2.5-flash", over);
    expect(decision.downgraded).toBe(false);
    expect(decision.model).toBe("gemini-2.5-flash");
  });

  it("radzi sobie z identyfikatorem bez prefiksu dostawcy", () => {
    expect(chooseModel("claude-opus-5", over).model).toBe("anthropic:claude-sonnet-5");
  });
});

describe("budgetMessage", () => {
  it("milczy, gdy wszystko w normie albo limit wyłączony", () => {
    expect(budgetMessage(budgetStatus(1, 5))).toBeNull();
    expect(budgetMessage(budgetStatus(999, 0))).toBeNull();
  });

  it("ostrzega przed degradacją, zanim ona nastąpi", () => {
    const msg = budgetMessage(budgetStatus(4.5, 5))!;
    expect(msg).toContain("90%");
    expect(msg).toContain("zejdą");
  });

  it("po przekroczeniu mówi, co się właśnie zmieniło", () => {
    expect(budgetMessage(budgetStatus(6, 5))!).toContain("tańszych modelach");
  });
});

// Etap 2 (A3/A12): budżet z księgi llm_usage, zsumowany po stronie bazy.
describe("summarizeSpend", () => {
  const rows = [
    {
      module: "agents",
      model: "gemini-2.5-flash",
      cost_usd: 0.25,
      calls: 4,
      unpriced: 0,
      today_usd: 0.1,
    },
    {
      module: "agents",
      model: "llama-3.1-8b-instant",
      cost_usd: 0.01,
      calls: 3,
      unpriced: 0,
      today_usd: 0,
    },
    {
      module: "markets",
      model: "claude-opus-5-5",
      cost_usd: 1.2,
      calls: 2,
      unpriced: 0,
      today_usd: 1.2,
    },
    { module: "markets", model: "nowy-model", cost_usd: 0, calls: 1, unpriced: 1, today_usd: 0 },
  ];

  it("suma i dzisiejsze wydatki to suma wierszy (panel zgadza się z księgą)", () => {
    const s = summarizeSpend(rows);
    expect(s.spentUsd).toBeCloseTo(1.46, 9);
    expect(s.todayUsd).toBeCloseTo(1.3, 9);
    expect(s.calls).toBe(10);
    expect(s.unpriced).toBe(1);
  });

  it("podział na moduły i modele z tych samych wierszy, największe pierwsze", () => {
    const s = summarizeSpend(rows);
    expect(s.byModule.map((r) => [r.key, r.costUsd, r.runs])).toEqual([
      ["markets", 1.2, 3],
      ["agents", 0.26, 7],
    ]);
    expect(s.byModule[0].label).toBe("Rynki");
    expect(s.byModel[0]).toMatchObject({ key: "claude-opus-5-5", costUsd: 1.2 });
    const moduleSum = s.byModule.reduce((a, r) => a + r.costUsd, 0);
    expect(moduleSum).toBeCloseTo(s.spentUsd, 9);
  });

  it("liczby z bazy mogą przyjść jako tekst (numeric)", () => {
    const s = summarizeSpend([
      {
        module: "brief",
        model: "m",
        cost_usd: "0.5" as never,
        calls: "2" as never,
        unpriced: 0,
        today_usd: "0" as never,
      },
    ]);
    expect(s.spentUsd).toBe(0.5);
    expect(s.calls).toBe(2);
  });
});

describe("monthSpendUsd — z księgi przez funkcję bazy", () => {
  it("woła llm_spend_by_module z właścicielem i początkiem miesiąca, sumuje wynik", async () => {
    const { makeDb } = await import("./runtime.testkit");
    const { monthSpendUsd } = await import("./budget.server");
    const { db, calls } = makeDb((table) =>
      table === "rpc:llm_spend_by_module"
        ? {
            data: [
              { module: "agents", model: "m", cost_usd: 1.5, calls: 3, unpriced: 0, today_usd: 0 },
              { module: "markets", model: "m", cost_usd: 0.5, calls: 2, unpriced: 1, today_usd: 0 },
            ],
            error: null,
          }
        : undefined,
    );
    const got = await monthSpendUsd(db, "u1", new Date("2026-11-11T12:00:00Z"));
    // runs = wywołania z ceną (jak dotąd): 5 − 1 bez stawki.
    expect(got).toMatchObject({ spentUsd: 2, runs: 4, error: null, source: "ledger" });
    expect(calls[0].ops[0].args).toEqual([
      "llm_spend_by_module",
      { p_owner: "u1", p_since: "2026-11-01T00:00:00.000Z" },
    ]);
    // Żadnego `select` wszystkich wierszy (A12).
    expect(calls.some((c) => c.table === "agent_runs")).toBe(false);
  });

  it("bez funkcji w bazie (migracja jeszcze nie weszła) liczy jak dotąd z agent_runs", async () => {
    const { makeDb } = await import("./runtime.testkit");
    const { monthSpendUsd } = await import("./budget.server");
    const { db } = makeDb((table) =>
      table === "rpc:llm_spend_by_module"
        ? { data: null, error: { message: "function llm_spend_by_module does not exist" } }
        : table === "agent_runs"
          ? { data: [{ cost_usd: 0.4 }, { cost_usd: 0.1 }], error: null }
          : undefined,
    );
    const got = await monthSpendUsd(db, "u1");
    expect(got).toMatchObject({ spentUsd: 0.5, runs: 2, source: "agent_runs" });
  });
});
