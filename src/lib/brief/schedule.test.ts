import { describe, expect, it } from "vitest";
import { decideBriefRun } from "./schedule";

const at = (iso: string) => new Date(iso);
const schedule = { hour: 7, push: true };

describe("decideBriefRun", () => {
  it("milczy przed godziną wybraną przez użytkownika", () => {
    // 04:30 UTC latem to 06:30 w Warszawie — jeszcze za wcześnie.
    expect(decideBriefRun(schedule, at("2026-07-15T04:30:00Z"), null)).toEqual({
      run: false,
      reason: "too_early",
    });
  });

  it("składa rubrykę, gdy godzina wybita", () => {
    // 05:30 UTC latem to 07:30 w Warszawie.
    expect(decideBriefRun(schedule, at("2026-07-15T05:30:00Z"), null)).toEqual({
      run: true,
      briefDate: "2026-07-15",
    });
  });

  it("liczy godzinę lokalnie, więc zimą ta sama chwila UTC znaczy co innego", () => {
    // 05:30 UTC zimą to dopiero 06:30 w Warszawie.
    expect(decideBriefRun(schedule, at("2026-01-15T05:30:00Z"), null).run).toBe(false);
    expect(decideBriefRun(schedule, at("2026-01-15T06:30:00Z"), null).run).toBe(true);
  });

  it("nie składa drugiej rubryki tego samego dnia", () => {
    // Bez tego każdy kolejny przebieg po wybranej godzinie wysyłałby nowe
    // powiadomienie o tym samym.
    expect(decideBriefRun(schedule, at("2026-07-15T09:30:00Z"), "2026-07-15")).toEqual({
      run: false,
      reason: "already_built",
    });
  });

  it("nadrabia zaległość, gdy przebieg się spóźnił", () => {
    // Briefing o 11:00 zamiast o 7:00 jest nadal wart przeczytania; cisza
    // nie niosłaby żadnej informacji.
    expect(decideBriefRun(schedule, at("2026-07-15T09:00:00Z"), "2026-07-14").run).toBe(true);
  });

  it("respektuje późną godzinę tak samo jak wczesną", () => {
    const evening = { hour: 20, push: false };
    expect(decideBriefRun(evening, at("2026-07-15T15:30:00Z"), null).run).toBe(false);
    expect(decideBriefRun(evening, at("2026-07-15T18:30:00Z"), null).run).toBe(true);
  });

  it("godzina 0 znaczy tuż po północy, a nie „nigdy”", () => {
    const midnight = { hour: 0, push: true };
    expect(decideBriefRun(midnight, at("2026-07-14T22:30:00Z"), null)).toEqual({
      run: true,
      briefDate: "2026-07-15",
    });
  });
});
