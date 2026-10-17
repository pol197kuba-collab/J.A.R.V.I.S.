import { describe, expect, it } from "vitest";
import { computeInsights, parseInsights } from "./insights";
import { buildTraceItems, MAX_TRACE_ITEMS, parseTraceItems } from "./trace";
import type { BrainSource } from "./layout";

const src = (id: string, embedding: number[], sourceType: BrainSource["sourceType"] = "note") =>
  ({
    sourceType,
    sourceId: id,
    label: `L-${id}`,
    embedding,
    weight: 3,
    sourceCreatedAt: "2026-10-01",
  }) satisfies BrainSource;

/** Wektor „wokół” osi k z małym odchyleniem w osi k+1. */
const around = (k: number, wobble: number, dims = 12) =>
  Array.from({ length: dims }, (_, d) => (d === k ? 1 : d === (k + 1) % dims ? wobble : 0));

describe("computeInsights", () => {
  it("duplikaty: prawie identyczne wektory, od najbardziej podobnych", () => {
    const s = [
      src("a", around(0, 0)),
      src("b", around(0, 0.05)),
      src("c", around(0, 0.2)),
      src("x", around(5, 0)),
    ];
    const r = computeInsights(s, [0, 0, 0, 1]);
    expect(r.duplicates.map((d) => [d.a.id, d.b.id])).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["a", "c"],
    ]);
    expect(r.duplicates[0].similarity).toBeGreaterThan(0.99);
  });

  it("samotne gwiazdy: najsłabiej powiązane z resztą", () => {
    const crowd = Array.from({ length: 12 }, (_, i) => src(`c${i}`, around(0, i * 0.02)));
    const lonely = src("sam", around(7, 0));
    const r = computeInsights([...crowd, lonely], new Array(13).fill(0));
    expect(r.orphans.map((o) => o.id)).toEqual(["sam"]);
    expect(r.orphans[0].bestSimilarity).toBeLessThan(0.1);
  });

  it("poniżej 10 gwiazd nie szuka samotnych (za mało, by mówić o odstawaniu)", () => {
    const r = computeInsights([src("a", around(0, 0)), src("b", around(5, 0))], [0, 1]);
    expect(r.orphans).toEqual([]);
  });

  it("gromady bez notatki: tylko duże i tylko bez żadnej notatki", () => {
    const s = [
      ...Array.from({ length: 6 }, (_, i) => src(`m${i}`, around(0, 0.1 * i), "memory")),
      ...Array.from({ length: 5 }, (_, i) =>
        src(`n${i}`, around(3, 0.1 * i), i ? "memory" : "note"),
      ),
      ...Array.from({ length: 3 }, (_, i) => src(`d${i}`, around(6, 0.1 * i), "document")),
    ];
    const assign = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2];
    expect(computeInsights(s, assign).clustersWithoutNote).toEqual([{ cluster: 0, size: 6 }]);
  });

  it("parseInsights: brak albo śmieci = puste wnioski", () => {
    expect(parseInsights(null).duplicates).toEqual([]);
    expect(parseInsights({ duplicates: "x", orphans: [1] }).orphans).toEqual([1]);
  });
});

describe("ślad RAG", () => {
  it("jedna pozycja na gwiazdę z najlepszym wynikiem, od najlepszego", () => {
    const items = buildTraceItems([
      { type: "document", id: "d1", score: 0.6 },
      { type: "document", id: "d1", score: 0.8 },
      { type: "note", id: "n1", score: null },
      { type: "memory", id: "m1", score: 0.7 },
      { type: "memory", id: "", score: 0.9 },
    ]);
    expect(items).toEqual([
      { type: "document", id: "d1", score: 0.8 },
      { type: "memory", id: "m1", score: 0.7 },
      { type: "note", id: "n1", score: null },
    ]);
  });

  it(`najwyżej ${MAX_TRACE_ITEMS} pozycji`, () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: "note" as const,
      id: `n${i}`,
      score: i / 40,
    }));
    expect(buildTraceItems(many)).toHaveLength(MAX_TRACE_ITEMS);
  });

  it("parseTraceItems odrzuca to, co nie jest gwiazdą", () => {
    expect(
      parseTraceItems([
        { type: "note", id: "a", score: 0.5 },
        { type: "task", id: "b" },
        { type: "memory", id: "" },
        "x",
        { type: "document", id: "c" },
      ]),
    ).toEqual([
      { type: "note", id: "a", score: 0.5 },
      { type: "document", id: "c", score: null },
    ]);
    expect(parseTraceItems(null)).toEqual([]);
  });
});
