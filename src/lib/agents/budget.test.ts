import { describe, expect, it } from "vitest";
import { budgetMessage, budgetStatus, chooseModel, WARN_AT } from "./budget";

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
