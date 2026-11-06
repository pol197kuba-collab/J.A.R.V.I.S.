import { describe, expect, it } from "vitest";
import {
  fundRefreshDue,
  liveDecisions,
  liveQuoteRows,
  parseAlarmReply,
  type LivePrice,
} from "./live";
import type { LivePosition } from "@/lib/fund/engine";

const NOW = new Date("2026-11-02T10:00:00Z");
const px = (price: number, at = "2026-11-02T09:55:00Z"): LivePrice => ({ price, at, source: "t" });
const pos = (over: Partial<LivePosition> = {}): LivePosition => ({
  symbol: "BTC",
  side: "long",
  refPx: 100,
  stop: 0.05,
  take: 0.075,
  expiresOn: "2026-11-04",
  signalOn: "2026-11-01",
  reason: "powód",
  ...over,
});

describe("liveDecisions", () => {
  it("realizuje czekające zlecenie tylko po świeżej cenie zaobserwowanej po prognozie", () => {
    const pending = [
      {
        symbol: "BTC",
        madeOn: "2026-11-01",
        madeAt: "2026-11-01T18:30:00Z",
        direction: "up" as const,
      },
      {
        symbol: "ETH",
        madeOn: "2026-11-02",
        madeAt: "2026-11-02T09:58:00Z",
        direction: "up" as const,
      },
      {
        symbol: "SPY.US",
        madeOn: "2026-11-01",
        madeAt: "2026-11-01T18:30:00Z",
        direction: "up" as const,
      },
    ];
    const { events } = liveDecisions(
      [{ key: "ai", pending, live: [] }],
      new Map([
        ["BTC", px(101)],
        ["ETH", px(50)], // cena sprzed prognozy (09:55 < 09:58)
        ["SPY.US", px(500, "2026-11-01T21:00:00Z")], // nieświeża — giełda zamknięta
      ]),
      NOW,
    );
    const { skipped } = liveDecisions(
      [{ key: "ai", pending, live: [] }],
      new Map([
        ["BTC", px(101)],
        ["ETH", px(50)],
        ["SPY.US", px(500, "2026-11-01T21:00:00Z")],
      ]),
      NOW,
    );
    expect(skipped.beforeForecast).toEqual(["ETH"]);
    expect(skipped.stale).toEqual(["SPY.US"]);
    expect(events).toEqual([
      {
        player: "ai",
        kind: "fill",
        symbol: "BTC",
        at: "2026-11-02T09:55:00Z",
        price: 101,
        signalOn: "2026-11-01",
      },
    ]);
  });

  it("stop-loss, take-profit i alarm przy zbliżaniu się do stopu (tylko gracze AI)", () => {
    const { events, alarms } = liveDecisions(
      [
        {
          key: "ai",
          pending: [],
          live: [pos(), pos({ symbol: "ETH" }), pos({ symbol: "SOL", side: "short" })],
        },
        { key: "ai_learned", pending: [], live: [pos({ symbol: "SOL", side: "short" })] },
        { key: "signals", pending: [], live: [pos({ symbol: "SOL", side: "short" })] },
      ],
      new Map([
        ["BTC", px(94.9)], // −5,1% → stop
        ["ETH", px(108)], // +8% → take
        ["SOL", px(103.5)], // short −3,5% = 70% drogi do stopu → alarm
      ]),
      NOW,
    );
    expect(events.map((e) => `${e.player}:${e.kind}:${e.symbol}`)).toEqual([
      "ai:stop:BTC",
      "ai:take:ETH",
    ]);
    expect(alarms).toHaveLength(1);
    expect(alarms[0].players).toEqual(["ai", "ai_learned"]);
    expect(alarms[0].move).toBeCloseTo(-0.035);
  });
});

describe("parseAlarmReply", () => {
  it("zamyka tylko przy wyraźnym „close”", () => {
    expect(parseAlarmReply('{"action":"close","reason_pl":"Przesłanki nieaktualne."}')).toEqual({
      action: "close",
      reasonPl: "Przesłanki nieaktualne.",
    });
    expect(parseAlarmReply("nie wiem").action).toBe("hold");
    expect(parseAlarmReply(null).action).toBe("hold");
  });
});

describe("wspólny takt rynku", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const cur = (s: string) => (s === "UNKNOWN" ? null : s.endsWith(".WA") ? "PLN" : "USD");

  it("zapisuje świeże ceny jako dzisiejsze notowanie, nie rusza prawdziwych zamknięć", () => {
    const prices = new Map([
      ["BTC", { price: 70_100, at: "2026-11-06T09:55:00Z", source: "coingecko" }],
      ["CDR.WA", { price: 262.4, at: "2026-11-06T09:50:00Z", source: "yahoo" }],
      ["AAPL", { price: 231, at: "2026-11-05T21:00:00Z", source: "yahoo" }],
      ["OLD", { price: 10, at: "2026-10-20T15:00:00Z", source: "yahoo" }],
      ["UNKNOWN", { price: 1, at: "2026-11-06T09:00:00Z", source: "yahoo" }],
    ]);
    const rows = liveQuoteRows(prices, cur, new Set(["AAPL|2026-11-05"]), now);
    expect(rows).toEqual([
      { symbol: "BTC", quote_date: "2026-11-06", close: 70_100, currency: "USD", source: "live" },
      { symbol: "CDR.WA", quote_date: "2026-11-06", close: 262.4, currency: "PLN", source: "live" },
    ]);
  });

  it("fundusz bez zdarzeń zapisuje się najwyżej raz na godzinę", () => {
    expect(fundRefreshDue(null, now)).toBe(true);
    expect(fundRefreshDue("2026-11-06T09:30:00Z", now)).toBe(false);
    expect(fundRefreshDue("2026-11-06T08:59:00Z", now)).toBe(true);
  });
});
