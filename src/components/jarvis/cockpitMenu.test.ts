import { describe, expect, it } from "vitest";
import { MODULE_ITEMS } from "./modules";
import { cockpitBlurb, cockpitColumns, cockpitMatches, firstMatch, moveSel } from "./cockpitMenu";

describe("cockpit menu", () => {
  it("has four columns covering every module once", () => {
    const cols = cockpitColumns();
    expect(cols).toHaveLength(4);
    const urls = cols.flatMap((c) => c.items.map((i) => i.url));
    expect(urls.sort()).toEqual(MODULE_ITEMS.map((m) => m.url).sort());
  });

  it("gives every module a one-line description", () => {
    MODULE_ITEMS.forEach((m) => expect(cockpitBlurb(m.title)).not.toBe(""));
  });

  it("searches titles, keywords and descriptions", () => {
    const rynki = MODULE_ITEMS.find((m) => m.url === "/rynki")!;
    expect(cockpitMatches(rynki, "RYN")).toBe(true);
    expect(cockpitMatches(rynki, "paper fund")).toBe(true);
    expect(cockpitMatches(rynki, "zzz")).toBe(false);
    const cols = cockpitColumns();
    const hit = firstMatch(cols, "sett")!;
    expect(cols[hit[0]].items[hit[1]].url).toBe("/settings");
    expect(firstMatch(cols, "")).toBeNull();
    // a name beats a description: "zada" is Zadania, not Dashboard ("…budżet i zadania")
    const z = firstMatch(cols, "zada")!;
    expect(cols[z[0]].items[z[1]].url).toBe("/tasks");
    // and a description still finds what no name does
    const p = firstMatch(cols, "paper fund")!;
    expect(cols[p[0]].items[p[1]].url).toBe("/rynki");
  });

  it("walks columns with the arrows, skipping filtered-out modules", () => {
    const cols = cockpitColumns();
    expect(moveSel(cols, null, "down")).toEqual([1, 0]);
    expect(moveSel(cols, [0, 0], "up")).toEqual([0, cols[0].items.length - 1]);
    expect(moveSel(cols, [3, 0], "right")).toEqual([0, 0]);
    const last = cols[1].items.length - 1;
    expect(moveSel(cols, [1, last], "left")).toEqual([0, Math.min(last, cols[0].items.length - 1)]);
    // with a filter, down jumps straight to the next match in the column
    const [c, r] = firstMatch(cols, "a")!;
    const next = moveSel(cols, [c, r], "down", "a");
    expect(cockpitMatches(cols[next[0]].items[next[1]], "a")).toBe(true);
  });
});
