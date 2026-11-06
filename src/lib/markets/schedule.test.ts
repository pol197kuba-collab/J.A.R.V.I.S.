import { describe, expect, it } from "vitest";
import { decideMarketRun, lastRunOfSession, SESSION_CLASSES, sessionAt } from "./schedule";

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

describe("sesje Market Grid", () => {
  it("rano (od 4:00 do 14:00 PL) poranna, potem wieczorna", () => {
    expect(sessionAt(new Date("2026-11-06T07:35:00Z"))).toBe("morning"); // 8:35 PL
    expect(sessionAt(new Date("2026-11-06T12:59:00Z"))).toBe("morning"); // 13:59
    expect(sessionAt(new Date("2026-11-06T13:00:00Z"))).toBe("evening"); // 14:00
    expect(sessionAt(new Date("2026-11-06T19:10:00Z"))).toBe("evening"); // 20:10
    expect(sessionAt(new Date("2026-11-06T23:30:00Z"))).toBe("evening"); // 0:30 nast. dnia
  });

  it("każda klasa instrumentów decyduje dokładnie w jednej sesji", () => {
    const all = [...SESSION_CLASSES.morning, ...SESSION_CLASSES.evening];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(["commodity", "crypto", "equity", "etf", "fx", "index"]);
  });

  it("poranny przebieg nie wstrzymuje wieczornego", () => {
    const runs = ["2026-11-06T07:40:00Z", "2026-11-05T19:05:00Z"]; // 8:40 PL dziś, 20:05 PL wczoraj
    expect(lastRunOfSession(runs, "evening")).toBe("2026-11-05T19:05:00Z");
    expect(lastRunOfSession(runs, "morning")).toBe("2026-11-06T07:40:00Z");
    // cron GitHuba o 20:00 PL: ostatni wieczorny był wczoraj → biegnie
    const now = new Date("2026-11-06T19:00:00Z");
    expect(decideMarketRun("schedule", lastRunOfSession(runs, "evening"), now)).toEqual({
      run: true,
    });
  });

  it("cron spóźniony na popołudnie nic nie robi", () => {
    expect(decideMarketRun("schedule", null, new Date("2026-11-06T15:00:00Z"))).toEqual({
      run: false,
      reason: "off_hours",
    }); // 16:00 PL
    expect(decideMarketRun("workflow_dispatch", null, new Date("2026-11-06T15:00:00Z"))).toEqual({
      run: true,
    });
  });
});
