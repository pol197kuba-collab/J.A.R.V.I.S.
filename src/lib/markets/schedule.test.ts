import { describe, expect, it } from "vitest";
import { decideMarketRun } from "./schedule";

const NOW = new Date("2026-10-20T22:30:00Z"); // 00:30 czasu PL, 21.10

describe("decideMarketRun", () => {
  it("ręczne i bazowe wywołanie zawsze biegnie", () => {
    expect(decideMarketRun("workflow_dispatch", "2026-10-20T22:00:00Z", NOW)).toEqual({
      run: true,
    });
    expect(decideMarketRun(undefined, "2026-10-20T22:00:00Z", NOW)).toEqual({ run: true });
  });

  it("cron bez żadnego przebiegu biegnie", () => {
    expect(decideMarketRun("schedule", null, NOW)).toEqual({ run: true });
  });

  it("spóźniony cron po północy pomija przebieg z 20:00 poprzedniego dnia", () => {
    // 20:05 PL 20.10 = 18:05 UTC; cron przyszedł 00:30 PL 21.10
    expect(decideMarketRun("schedule", "2026-10-20T18:05:00Z", NOW)).toEqual({
      run: false,
      reason: "recent_run",
      lastFinishedAt: "2026-10-20T18:05:00Z",
    });
  });

  it("wczorajszy przebieg nie wstrzymuje dzisiejszego", () => {
    expect(decideMarketRun("schedule", "2026-10-19T18:05:00Z", NOW)).toEqual({ run: true });
  });

  it("przebieg z przyszłości (rozjechany zegar) nie blokuje", () => {
    expect(decideMarketRun("schedule", "2026-10-21T05:00:00Z", NOW)).toEqual({ run: true });
  });
});
