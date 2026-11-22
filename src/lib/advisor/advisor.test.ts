import { describe, expect, it } from "vitest";
import {
  buildPlay,
  consensus,
  DEFAULT_ADVISOR_SETTINGS,
  esmaLeverage,
  marketMood,
  orderText,
  parseAdvisorSettings,
  type AdvisorInstrument,
  type Vote,
} from "./plan";
import { exitAlerts, playKey, playsToNotify, pushWindowOpen, warsawClock } from "./alerts";

const v = (player: Vote["player"], direction: Vote["direction"], confidence: number): Vote => ({
  player,
  direction,
  confidence,
  rationalePl: null,
  madeAt: null,
});

/** 30 zamknięć na przemian ±1% — σ ≈ 1%. */
function closes(start = 100): { date: string; close: number }[] {
  const out = [];
  let p = start;
  for (let i = 0; i < 30; i++) {
    p *= i % 2 === 0 ? 1.01 : 0.99;
    out.push({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, close: p });
  }
  return out;
}

const inst = (over: Partial<AdvisorInstrument> = {}): AdvisorInstrument => ({
  symbol: "BTC",
  label: "Bitcoin",
  assetClass: "crypto",
  currency: "USD",
  price: 100,
  priceAt: null,
  fxToPln: 4,
  closes: closes(),
  votes: [
    v("ai", "down", 80),
    v("ai_learned", "down", 90),
    v("ai_7d", "down", 70),
    v("signals", "down", 60),
  ],
  regime: null,
  technicalScore: null,
  sentimentScore: null,
  news: [],
  history: null,
  ...over,
});

describe("consensus", () => {
  it("averages signed confidence; disagreement cancels", () => {
    expect(consensus([v("ai", "up", 80), v("signals", "down", 80)])).toMatchObject({
      direction: "flat",
      strength: 0,
    });
    const c = consensus([
      v("ai", "down", 80),
      v("ai_learned", "down", 60),
      v("signals", "flat", 50),
    ]);
    expect(c).toEqual({ direction: "down", strength: 47, agree: 2, total: 3 });
  });
});

describe("esmaLeverage", () => {
  it("follows ESMA retail caps", () => {
    expect(esmaLeverage("BTC", "crypto")).toBe(2);
    expect(esmaLeverage("AAPL.US", "equity")).toBe(5);
    expect(esmaLeverage("SPX", "index")).toBe(20);
    expect(esmaLeverage("WIG20", "index")).toBe(10);
    expect(esmaLeverage("ETFBW20.PL", "index")).toBe(5);
    expect(esmaLeverage("XAUUSD", "commodity")).toBe(20);
    expect(esmaLeverage("BRENT", "commodity")).toBe(10);
    expect(esmaLeverage("USDPLN", "fx")).toBe(20);
  });
});

describe("buildPlay", () => {
  it("short with SL above / TP below and risk = capital × risk%", () => {
    const p = buildPlay(inst(), { ...DEFAULT_ADVISOR_SETTINGS, maxExposure: 5 }, "2026-11-22")!;
    expect(p.side).toBe("sell");
    expect(p.strength).toBe(75);
    expect(p.grade).toBe("strong");
    expect(p.stop).toBeGreaterThan(p.entry);
    expect(p.take).toBeLessThan(p.entry);
    // 10 000 zł × 2% = 200 zł ryzyka przy SL (bez ograniczeń)
    expect(p.riskPln).toBeCloseTo(200, 0);
    expect(p.rewardPln / p.riskPln).toBeCloseTo(1.5, 5);
    expect(p.leverage).toBe(2);
    expect(p.marginPln).toBeCloseTo(p.nominalPln / 2, 5);
    expect(p.expiresOn).toBe("2026-11-24");
    expect(p.lots).toBeNull();
  });

  it("weaker signal risks less", () => {
    const p = buildPlay(
      inst({ votes: [v("ai", "up", 60), v("signals", "up", 50)] }),
      { ...DEFAULT_ADVISOR_SETTINGS, maxExposure: 5 },
      "2026-11-22",
    )!;
    expect(p.grade).toBe("medium");
    expect(p.riskPln).toBeCloseTo(120, 0);
  });

  it("caps exposure and says so", () => {
    const s = { ...DEFAULT_ADVISOR_SETTINGS, riskPct: 20, maxExposure: 0.5 };
    const p = buildPlay(inst(), s, "2026-11-22")!;
    expect(p.nominalPln).toBeCloseTo(5000, 5);
    expect(p.sizeNote).toMatch(/Ograniczone/);
  });

  it("rounds to XTB lots and enforces the minimum lot", () => {
    const s = {
      ...DEFAULT_ADVISOR_SETTINGS,
      xtb: { BTC: { contractSize: 1, lotStep: 0.01, minLot: 0.01 } },
    };
    const p = buildPlay(inst(), s, "2026-11-22")!;
    expect(p.lots).not.toBeNull();
    expect(Math.abs(p.lots! * 100 - Math.round(p.lots! * 100))).toBeLessThan(1e-9);
    const tiny = buildPlay(inst({ price: 1_000_000 }), s, "2026-11-22")!;
    expect(tiny.lots).toBe(0.01);
    expect(tiny.sizeNote).toMatch(/Minimalna pozycja/);
  });

  it("no play on too few votes, weak consensus or short history", () => {
    expect(
      buildPlay(inst({ votes: [v("ai", "down", 90)] }), DEFAULT_ADVISOR_SETTINGS, "2026-11-22"),
    ).toBeNull();
    expect(
      buildPlay(
        inst({ votes: [v("ai", "down", 20), v("signals", "flat", 50)] }),
        DEFAULT_ADVISOR_SETTINGS,
        "2026-11-22",
      ),
    ).toBeNull();
    expect(
      buildPlay(inst({ closes: closes().slice(0, 3) }), DEFAULT_ADVISOR_SETTINGS, "2026-11-22"),
    ).toBeNull();
  });

  it("stock horizon counts sessions, not weekend days", () => {
    // 2 dni = 1 sesja (jak w funduszu): prognoza z piątku kończy się w poniedziałek
    const p = buildPlay(
      inst({ symbol: "AAPL.US", assetClass: "equity" }),
      DEFAULT_ADVISOR_SETTINGS,
      "2026-11-20",
    )!;
    expect(p.expiresOn).toBe("2026-11-23");
    expect(p.leverage).toBe(5);
  });

  it("order text is one line for XTB", () => {
    const p = buildPlay(inst(), DEFAULT_ADVISOR_SETTINGS, "2026-11-22")!;
    expect(orderText(p, (x) => x.toFixed(2))).toMatch(
      /^XTB BITCOIN: SPRZEDAJ .* · SL .* · TP .* · zamknij do 2026-11-24$/,
    );
  });
});

describe("parseAdvisorSettings", () => {
  it("defaults on garbage, keeps valid values and XTB specs", () => {
    expect(parseAdvisorSettings(null)).toEqual(DEFAULT_ADVISOR_SETTINGS);
    const s = parseAdvisorSettings({
      capitalPln: 25000,
      riskPct: 99,
      pushFromHour: 22,
      pushToHour: 6,
      xtb: { BTC: { name: " BITCOIN ", contractSize: 1 }, "bad key!": { name: "x" } },
    });
    expect(s.capitalPln).toBe(25000);
    expect(s.riskPct).toBe(2);
    expect(s.pushToHour).toBe(23);
    expect(s.xtb).toEqual({ BTC: { name: "BITCOIN", contractSize: 1 } });
  });
});

describe("marketMood", () => {
  it("counts consensus directions", () => {
    expect(
      marketMood([
        inst(),
        inst({ votes: [v("ai", "up", 80), v("signals", "up", 70)] }),
        inst({ votes: [v("ai", "up", 10), v("signals", "flat", 70)] }),
      ]),
    ).toEqual({ up: 1, down: 1, flat: 1 });
  });
});

describe("alerts", () => {
  it("Warsaw clock and push window", () => {
    const now = new Date("2026-11-22T21:30:00Z"); // 22:30 w Warszawie
    expect(warsawClock(now)).toEqual({ hour: 22, day: "2026-11-22" });
    expect(pushWindowOpen(now, 7, 23)).toBe(true);
    expect(pushWindowOpen(new Date("2026-11-22T22:30:00Z"), 7, 23)).toBe(false);
  });

  it("notifies strong plays once per day", () => {
    const p = buildPlay(inst(), DEFAULT_ADVISOR_SETTINGS, "2026-11-22")!;
    expect(playsToNotify([p], 70, new Set(), "2026-11-22")).toHaveLength(1);
    expect(playsToNotify([p], 70, new Set([playKey(p, "2026-11-22")]), "2026-11-22")).toHaveLength(
      0,
    );
    expect(playsToNotify([p], 80, new Set(), "2026-11-22")).toHaveLength(0);
  });

  const pos = {
    id: "1",
    symbol: "BTC",
    label: "Bitcoin",
    side: "sell" as const,
    entry: 100,
    stop: 104,
    take: 94,
    expiresOn: "2026-11-24",
    alerts: [] as string[],
  };
  const fmt = (x: number) => x.toFixed(0);

  it("take / stop for a short, once each", () => {
    expect(
      exitAlerts([pos], new Map([["BTC", 93]]), new Map(), "2026-11-23", fmt)[0],
    ).toMatchObject({
      kind: "take",
      closes: true,
    });
    expect(exitAlerts([pos], new Map([["BTC", 105]]), new Map(), "2026-11-23", fmt)[0].kind).toBe(
      "stop",
    );
    expect(
      exitAlerts(
        [{ ...pos, alerts: ["stop"] }],
        new Map([["BTC", 105]]),
        new Map(),
        "2026-11-23",
        fmt,
      ),
    ).toEqual([]);
  });

  it("flip when consensus turns against, expiry on the due day", () => {
    const flip = new Map([["BTC", { direction: "up" as const, strength: 60, agree: 3, total: 4 }]]);
    expect(exitAlerts([pos], new Map([["BTC", 101]]), flip, "2026-11-23", fmt)[0].kind).toBe(
      "flip",
    );
    expect(exitAlerts([pos], new Map([["BTC", 101]]), new Map(), "2026-11-24", fmt)[0].kind).toBe(
      "expired",
    );
    expect(exitAlerts([pos], new Map([["BTC", 101]]), new Map(), "2026-11-23", fmt)).toEqual([]);
  });
});
