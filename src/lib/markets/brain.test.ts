import { describe, expect, it } from "vitest";
import {
  divergenceScore,
  divergences,
  learningFunnel,
  lessonKey,
  lessonTimeline,
  type BrainPrediction,
} from "./brain";

describe("lessonKey", () => {
  it("ignores the numbers that change from day to day", () => {
    expect(lessonKey("Prognozy wzrostu w trendzie: trafiły 5 z 69 (7%).")).toBe(
      lessonKey("Prognozy wzrostu w trendzie: trafiły 6 z 71 (8,5%)."),
    );
    expect(lessonKey("zagranie dawało −1,2% po kosztach")).toBe(
      lessonKey("zagranie dawało +0,4% po kosztach"),
    );
    expect(lessonKey("prognozy wzrostu")).not.toBe(lessonKey("prognozy spadku"));
  });
});

describe("lessonTimeline", () => {
  const rows = [
    { madeOn: "2026-11-02", lessons: ["A: 5 z 20", "B: 3 z 14"] },
    { madeOn: "2026-11-02", lessons: ["A: 5 z 20"] },
    { madeOn: "2026-11-03", lessons: ["A: 6 z 22"] },
    { madeOn: "2026-11-05", lessons: ["A: 7 z 25"] },
  ];

  it("spans each lesson from first to last day, latest wording, active first", () => {
    const t = lessonTimeline(rows, ["A: 8 z 27", "C: 4 z 12"], "2026-11-06");
    expect(t.map((s) => [s.text, s.firstSeen, s.lastSeen, s.days, s.active])).toEqual([
      ["C: 4 z 12", "2026-11-06", "2026-11-06", 0, true],
      ["A: 8 z 27", "2026-11-02", "2026-11-05", 3, true],
      ["B: 3 z 14", "2026-11-02", "2026-11-02", 1, false],
    ]);
  });
});

const p = (over: Partial<BrainPrediction>): BrainPrediction => ({
  symbol: "BTC",
  madeOn: "2026-11-05",
  source: "ai",
  direction: "up",
  confidence: 60,
  rationalePl: null,
  outcome: null,
  actualChangePct: null,
  ...over,
});

describe("divergences", () => {
  it("pairs the same instrument and day where the directions differ", () => {
    const rows = [
      p({ source: "ai", direction: "up", outcome: "miss" }),
      p({ source: "ai_learned", direction: "down", outcome: "hit", rationalePl: "wniosek" }),
      p({ symbol: "ETH", source: "ai", direction: "up" }),
      p({ symbol: "ETH", source: "ai_learned", direction: "up" }),
      p({ symbol: "SOL", madeOn: "2026-11-06", source: "ai", direction: "flat" }),
      p({ symbol: "SOL", madeOn: "2026-11-06", source: "ai_learned", direction: "up" }),
    ];
    const d = divergences(rows);
    expect(d.map((x) => [x.symbol, x.madeOn])).toEqual([
      ["SOL", "2026-11-06"],
      ["BTC", "2026-11-05"],
    ]);
    expect(d[1].learned.rationalePl).toBe("wniosek");
    expect(divergenceScore(d)).toEqual({ settled: 1, learnedRight: 1, plainRight: 0 });
  });
});

describe("learningFunnel", () => {
  it("counts settled predictions by player and asset class", () => {
    const f = learningFunnel([
      { source: "ai", symbol: "BTC" },
      { source: "signals", symbol: "BTC" },
      { source: "ai", symbol: "UNKNOWN" },
    ]);
    expect(f).toEqual({
      total: 3,
      bySource: { ai: 2, signals: 1 },
      byClass: { crypto: 2, other: 1 },
    });
  });
});
