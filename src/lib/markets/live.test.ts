import { describe, expect, it } from "vitest";
import { liveDecisions, parseAlarmReply, type LivePrice } from "./live";
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
        ["ETH", px(50)], // cena sprzed prognozy
        ["SPY.US", px(500, "2026-11-01T21:00:00Z")], // nieświeża — giełda zamknięta
      ]),
      NOW,
    );
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
