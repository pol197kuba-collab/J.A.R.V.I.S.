import { describe, expect, it } from "vitest";
import { pluralPl } from "./loginStatus";

describe("pluralPl", () => {
  const f = (n: number) => pluralPl(n, "węzeł", "węzły", "węzłów");
  it("picks the Polish form", () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 112].map(f)).toEqual([
      "węzłów",
      "węzeł",
      "węzły",
      "węzły",
      "węzłów",
      "węzłów",
      "węzłów",
      "węzłów",
      "węzłów",
      "węzły",
      "węzłów",
      "węzłów",
    ]);
  });
});
