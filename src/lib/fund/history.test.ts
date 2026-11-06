import { describe, expect, it } from "vitest";
import { episodes, type HistoryTrade } from "./history";

const t = (
  executedOn: string,
  symbol: string,
  side: "buy" | "sell",
  units: number,
  price: number,
  realizedPln: number | null = null,
): HistoryTrade => ({
  executedOn,
  symbol,
  side,
  units,
  price,
  notionalPln: units * price * 4,
  realizedPln,
  reason: `${side} ${symbol}`,
});

describe("fund history episodes", () => {
  it("joins an open, a top-up and two partial sells into one closed long", () => {
    const list = episodes([
      t("2026-11-04", "GC=F", "sell", 1, 2700, 120),
      t("2026-11-02", "GC=F", "buy", 1, 2600),
      t("2026-11-03", "GC=F", "buy", 1, 2650),
      t("2026-11-05", "GC=F", "sell", 1, 2720, 200),
    ]);
    expect(list).toHaveLength(1);
    const e = list[0];
    expect(e.side).toBe("long");
    expect(e.openedOn).toBe("2026-11-02");
    expect(e.closedOn).toBe("2026-11-05");
    expect(e.entryPrice).toBeCloseTo(2625);
    expect(e.exitPrice).toBeCloseTo(2710);
    expect(e.realizedPln).toBe(320);
    expect(e.trades).toBe(4);
    expect(e.reason).toBe("buy GC=F");
    expect(e.returnPct).toBeCloseTo((320 / (2600 * 4 + 2650 * 4)) * 100);
  });

  it("keeps an open position open and orders newest first", () => {
    const list = episodes([
      t("2026-11-01", "BTC-USD", "sell", 2, 70000),
      t("2026-11-02", "BTC-USD", "buy", 2, 68000, 500),
      t("2026-11-03", "ETH-USD", "buy", 5, 3000),
    ]);
    expect(list.map((e) => [e.symbol, e.side, e.closedOn])).toEqual([
      ["ETH-USD", "long", null],
      ["BTC-USD", "short", "2026-11-02"],
    ]);
    expect(list[0].exitPrice).toBeNull();
    expect(list[0].returnPct).toBeNull();
  });

  it("same-day flip: closes the long before opening the short", () => {
    const list = episodes([
      t("2026-11-03", "SPY", "sell", 3, 500), // open short (no result)
      t("2026-11-02", "SPY", "buy", 2, 490),
      t("2026-11-03", "SPY", "sell", 2, 500, 80), // close long
    ]);
    expect(list.map((e) => [e.side, e.openedOn, e.closedOn])).toEqual([
      ["short", "2026-11-03", null],
      ["long", "2026-11-02", "2026-11-03"],
    ]);
  });

  it("a single trade crossing zero opens the opposite side with the rest", () => {
    const list = episodes([
      t("2026-11-02", "SPY", "buy", 2, 490),
      t("2026-11-03", "SPY", "sell", 5, 500, 80),
    ]);
    expect(list[0]).toMatchObject({ side: "short", closedOn: null, entryPrice: 500 });
    expect(list[1]).toMatchObject({ side: "long", closedOn: "2026-11-03", realizedPln: 80 });
  });
});
