import { describe, expect, it } from "vitest";
import { bareModelId, costUsd, formatUsd, hasPricing } from "./pricing";

describe("costUsd", () => {
  it("liczy wejście i wyjście po różnych stawkach", () => {
    // Opus 5: $5/M wejścia, $25/M wyjścia.
    expect(costUsd("claude-opus-5", { input: 1_000_000, output: 0 })).toBeCloseTo(5, 6);
    expect(costUsd("claude-opus-5", { input: 0, output: 1_000_000 })).toBeCloseTo(25, 6);
  });

  it("zdejmuje prefiks dostawcy — to ten sam model i ta sama cena", () => {
    expect(costUsd("anthropic:claude-opus-5", { input: 1_000_000, output: 0 })).toBeCloseTo(5, 6);
  });

  it("liczy cache taniej przy odczycie i drożej przy zapisie", () => {
    // To jest sedno: bez tego licznik rozjeżdża się z rachunkiem w obie
    // strony i robi to niezauważalnie.
    const read = costUsd("claude-opus-5", { input: 0, output: 0, cacheRead: 1_000_000 })!;
    const write = costUsd("claude-opus-5", { input: 0, output: 0, cacheWrite: 1_000_000 })!;
    expect(read).toBeCloseTo(0.5, 6); // 0,1 × $5
    expect(write).toBeCloseTo(6.25, 6); // 1,25 × $5
    expect(write).toBeGreaterThan(read);
  });

  it("nieznany model daje null, nigdy zera", () => {
    // Zero znaczyłoby „nic nie kosztowało" i po cichu zaniżało budżet
    // dokładnie wtedy, gdy ktoś dołożył nowy model bez stawki.
    expect(costUsd("jakis-nowy-model", { input: 1_000_000, output: 1_000_000 })).toBeNull();
    expect(hasPricing("jakis-nowy-model")).toBe(false);
    expect(hasPricing("anthropic:claude-sonnet-5")).toBe(true);
  });

  it("nie daje ujemnych kwot na zepsutym wejściu", () => {
    expect(costUsd("claude-opus-5", { input: -100, output: -100 })).toBe(0);
  });

  it("Gemini Flash jest o rzędy wielkości tańszy od Opusa", () => {
    const opus = costUsd("claude-opus-5", { input: 100_000, output: 20_000 })!;
    const flash = costUsd("gemini-2.5-flash", { input: 100_000, output: 20_000 })!;
    expect(flash).toBeLessThan(opus / 10);
  });
});

describe("bareModelId", () => {
  it("zostawia identyfikator bez prefiksu w spokoju", () => {
    expect(bareModelId("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(bareModelId("anthropic:claude-opus-5")).toBe("claude-opus-5");
  });
});

describe("formatUsd", () => {
  it("pokazuje ułamki centa przy małych kwotach", () => {
    expect(formatUsd(0.0042)).toBe("$0,0042");
    expect(formatUsd(1.27)).toBe("$1,27");
  });
});
