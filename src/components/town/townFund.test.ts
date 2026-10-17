import { describe, expect, it } from "vitest";
import type { FundView } from "@/lib/fund/fund.functions";
import { metricFloorLine, moodOf, pctLabel, pixelSafe, townFund } from "./townFund";

const view = (overrides: Partial<FundView> = {}): FundView => ({
  startedOn: "2026-10-01",
  computedAt: "2026-10-10T18:00:00Z",
  players: [
    {
      key: "ai",
      label: "AI",
      kind: "source",
      metrics: { returnPct: 2.5 } as never,
      navPln: 102_500,
      cashPln: 1,
    },
    {
      key: "signals",
      label: "Sygnały",
      kind: "source",
      metrics: { returnPct: -1 } as never,
      navPln: 99_000,
      cashPln: 1,
    },
    {
      key: "basket",
      label: "Koszyk",
      kind: "benchmark",
      metrics: { returnPct: 1 } as never,
      navPln: 101_000,
      cashPln: 1,
    },
  ],
  nav: [
    { date: "2026-10-08", ai: 100_000, signals: 100_000, basket: 100_000 },
    { date: "2026-10-09", ai: 102_000, signals: 99_500, basket: 100_500 },
    { date: "2026-10-10", ai: 102_500, signals: 99_000, basket: 101_000 },
  ],
  positions: { ai: [{ symbol: "CDR.PL", valuePln: 11_000, costPln: 10_000 }] },
  orders: {},
  ...overrides,
});

describe("townFund", () => {
  it("ranks players and derives yesterday's change from the last two valuations", () => {
    const f = townFund(view())!;
    expect(f.players.map((p) => p.key)).toEqual(["ai", "basket", "signals"]);
    expect(f.players[0].dayPct).toBeCloseTo((102_500 / 102_000 - 1) * 100);
    // średnia tylko z graczy-prognoz (AI, Sygnały), bez koszyka
    const expected = ((102_500 / 102_000 - 1) * 100 + (99_000 / 99_500 - 1) * 100) / 2;
    expect(f.dayAvg).toBeCloseTo(expected);
    expect(f.curves.ai).toEqual([100_000, 102_000, 102_500]);
    expect(f.heat).toEqual([{ symbol: "CDR.PL", plPct: expect.closeTo(10, 5) }]);
  });

  it("ticker is pixel-font safe and signed", () => {
    const f = townFund(view())!;
    for (const t of f.ticker) expect(t.text).toMatch(/^[A-Z0-9 +\-%.,:/▲▼]*$/);
    expect(f.ticker).toContainEqual({ text: "AI +2,50%", sign: 1 });
    expect(f.ticker).toContainEqual({ text: "SYGN -1,00%", sign: -1 });
    expect(f.ticker.some((t) => t.text.startsWith("CDR +10,0%"))).toBe(true);
  });

  it("mood and statue follow the forecast players' day", () => {
    expect(moodOf(null)).toBe("flat");
    expect(moodOf(-0.5)).toBe("down");
    expect(moodOf(0.1)).toBe("flat");
    expect(moodOf(0.4)).toBe("up");
    const crash = townFund(
      view({
        nav: [
          { date: "2026-10-09", ai: 100_000, signals: 100_000, basket: 100_000 },
          { date: "2026-10-10", ai: 99_000, signals: 99_000, basket: 100_000 },
        ],
      }),
    )!;
    expect(crash.mood).toBe("down");
    expect(crash.statue).toBe("bear");
    expect(metricFloorLine(crash)).toBe("Wczoraj -1,00%… boli.");
  });

  it("no fund, no floor data; one day of history is calm", () => {
    expect(townFund(null)).toBeNull();
    expect(townFund(view({ players: [] }))).toBeNull();
    const first = townFund(view({ nav: [{ date: "2026-10-10", ai: 100_000 }] }))!;
    expect(first.dayAvg).toBeNull();
    expect(first.statue).toBe("calm");
    expect(metricFloorLine(first)).toBe("Fundusz dopiero startuje.");
  });

  it("formats like the boards", () => {
    expect(pctLabel(2.345)).toBe("+2,35%");
    expect(pctLabel(-0.5, 1)).toBe("-0,5%");
    expect(pixelSafe("Małpa z rzutkami")).toBe("MALPA Z RZUTKAMI");
  });
});

describe("floor props text", async () => {
  const { rankingText, statueText, terminalText } = await import("./townFund");
  it("ranking, statue and terminal speak real numbers", () => {
    const f = townFund(view())!;
    expect(rankingText(f, ["Prowadzi: AI (+2,50%)."])).toBe(
      "1. AI +2,50%\n2. Koszyk +1,00%\n3. Sygnały -1,00%\nProwadzi: AI (+2,50%).",
    );
    expect(rankingText(null, [])).toMatch(/nie był jeszcze przeliczony/);
    expect(statueText(f)).toMatch(/^(Złoty byk|Brązowy niedźwiedź|Byk drzemie)/);
    expect(statueText(null)).toMatch(/czeka na pierwszy pełny dzień/);
    expect(
      terminalText("AI", [
        {
          executedOn: "2026-10-10",
          side: "buy",
          symbol: "BTC",
          notionalPln: 12345.6,
          reason: "RSI niski",
        },
      ]),
    ).toBe("2026-10-10 kupno BTC za 12\u00a0346 zł — RSI niski");
    expect(terminalText("AI", [])).toBe("AI: brak transakcji.");
  });
});
