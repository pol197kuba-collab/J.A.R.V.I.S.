import { describe, expect, it } from "vitest";
import { keywordStems, stemsOrFilter } from "./keywords";

describe("keywordStems", () => {
  it("drops filler words and trims Polish endings", () => {
    expect(keywordStems("Skąd wie o Marvelu?")).toEqual(["marve"]);
  });

  it("keeps short meaningful words whole and dedupes", () => {
    expect(keywordStems("VBA i VBA, Power Query")).toEqual(["power", "query", "vba"]);
    expect(keywordStems("kawa kawa")).toEqual(["kawa"]);
  });

  it("returns only letters/digits and caps the count", () => {
    const stems = keywordStems("a,b%(c) psychologia analityka produktowa portfel rynek giełda");
    expect(stems.length).toBeLessThanOrEqual(4);
    for (const s of stems) expect(s).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it("is empty when nothing meaningful is left", () => {
    expect(keywordStems("skąd to wiesz?")).toEqual([]);
  });
});

describe("stemsOrFilter", () => {
  it("builds one ilike per stem and column", () => {
    expect(stemsOrFilter(["marve"], ["title", "body"])).toBe(
      "title.ilike.%marve%,body.ilike.%marve%",
    );
  });
});
