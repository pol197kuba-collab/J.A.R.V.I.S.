// Testy pod konkretny obrazek: kafel „ACTIVE TASK, TIME: 558m" nad agentem,
// który od dziewięciu godzin niczego nie robi.
import { describe, expect, it } from "vitest";
import { AGENT_STALE_AFTER_MS, isWedged, wedgedRunReason } from "./agentStatus.recovery";

const NOW = new Date("2026-09-23T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("isWedged", () => {
  it("nie rusza agenta, który właśnie pracuje", () => {
    expect(isWedged({ status: "busy", busySince: ago(60_000) }, NOW)).toBe(false);
  });

  it("uznaje za wiszącego agenta zajętego od godzin", () => {
    expect(isWedged({ status: "busy", busySince: ago(9 * 3600_000) }, NOW)).toBe(true);
  });

  it("tuż przed progiem jeszcze nie rusza, na progu już tak", () => {
    expect(isWedged({ status: "busy", busySince: ago(AGENT_STALE_AFTER_MS - 1000) }, NOW)).toBe(
      false,
    );
    expect(isWedged({ status: "busy", busySince: ago(AGENT_STALE_AFTER_MS) }, NOW)).toBe(true);
  });

  it("status „busy” bez znacznika czasu to wiersz niespójny sam ze sobą", () => {
    // Nic go już nie posprząta, bo nie ma czego porównać z zegarem.
    expect(isWedged({ status: "busy", busySince: null }, NOW)).toBe(true);
    expect(isWedged({ status: "busy", busySince: "nie-data" }, NOW)).toBe(true);
  });

  it("nie dotyka agentów bezczynnych ani w błędzie", () => {
    expect(isWedged({ status: "idle", busySince: null }, NOW)).toBe(false);
    expect(isWedged({ status: "error", busySince: ago(9 * 3600_000) }, NOW)).toBe(false);
  });
});

describe("wedgedRunReason", () => {
  it("tłumaczy przyczynę, a nie tylko nazywa stan", () => {
    expect(wedgedRunReason()).toContain("uśpienie aplikacji");
  });
});
