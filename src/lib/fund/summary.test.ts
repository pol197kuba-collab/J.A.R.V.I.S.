import { describe, expect, it } from "vitest";
import { addDays, simulate, type FundSignal, type PriceBook } from "./engine";
import { compareBySymbol, summarizePlayer, type SummaryOrder } from "./summary";

const order = (o: Partial<SummaryOrder> & Pick<SummaryOrder, "symbol" | "side">): SummaryOrder => ({
  notionalPln: 10_000,
  feePln: 10,
  realizedPln: null,
  ...o,
});

describe("summarizePlayer", () => {
  it("liczy kupna, sprzedaże, zyskowne zamknięcia i wynik per instrument", () => {
    const s = summarizePlayer(
      [
        order({ symbol: "A", side: "buy" }),
        order({ symbol: "A", side: "sell", realizedPln: 300 }),
        order({ symbol: "B", side: "buy" }),
        order({ symbol: "B", side: "sell", realizedPln: -500 }),
        order({ symbol: "C", side: "sell" }), // otwarcie krótkiej
      ],
      [{ symbol: "C", valuePln: -9_000, costPln: -9_990 }],
    );
    expect(s.buys).toBe(2);
    expect(s.sells).toBe(3);
    expect(s.closed).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.realizedPln).toBe(-200);
    expect(s.unrealizedPln).toBeCloseTo(990);
    expect(s.totalPln).toBeCloseTo(790);
    expect(s.feesPln).toBe(50);
    expect(s.best?.symbol).toBe("C");
    expect(s.best?.open).toBe("short");
    expect(s.worst?.symbol).toBe("B");
    expect(s.bySymbol.map((r) => r.symbol)).toEqual(["C", "A", "B"]);
  });

  it("bez transakcji: zera i brak najlepszego/najgorszego", () => {
    const s = summarizePlayer([], []);
    expect(s.totalPln).toBe(0);
    expect(s.best).toBeNull();
    expect(s.worst).toBeNull();
  });

  it("suma wyników = wycena − kapitał startowy (zgodność z rankingiem)", () => {
    const start = "2026-10-01";
    const closes = new Map([
      [
        "A",
        [10, 11, 12, 11, 10, 9, 9, 9, 9, 9].map((c, i) => ({ date: addDays(start, i), close: c })),
      ],
      [
        "B",
        [10, 9, 8, 8, 9, 10, 10, 10, 10, 10].map((c, i) => ({ date: addDays(start, i), close: c })),
      ],
    ]);
    const book: PriceBook = {
      closes,
      instruments: new Map([
        ["A", { assetClass: "equity", currency: "PLN" }],
        ["B", { assetClass: "crypto", currency: "PLN" }],
      ]),
    };
    const sig = (symbol: string, day: number, direction: FundSignal["direction"]): FundSignal => ({
      symbol,
      madeOn: addDays(start, day),
      direction,
      confidence: 80,
      reason: null,
      predictionId: null,
    });
    const r = simulate([sig("A", 0, "up"), sig("B", 0, "down"), sig("A", 3, "down")], book, {
      start,
      end: addDays(start, 6),
    });
    const s = summarizePlayer(
      r.trades.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        notionalPln: t.notionalPln,
        feePln: t.feePln,
        realizedPln: t.realizedPln,
      })),
      r.holdings,
      r.financingPln,
    );
    expect(r.financingPln).toBeGreaterThan(0);
    expect(s.totalPln).toBeCloseTo(r.nav.at(-1)!.navPln - 100_000, 6);
  });
});

describe("compareBySymbol", () => {
  it("instrument × gracz, najwięcej straconego przez źródła na górze", () => {
    const a = summarizePlayer(
      [
        order({ symbol: "X", side: "sell", realizedPln: -800 }),
        order({ symbol: "Y", side: "sell", realizedPln: 200 }),
      ],
      [],
    );
    const b = summarizePlayer([order({ symbol: "Y", side: "sell", realizedPln: -100 })], []);
    const m = summarizePlayer([order({ symbol: "Z", side: "sell", realizedPln: -5_000 })], []);
    const rows = compareBySymbol({ ai: a, signals: b, monkey: m }, ["ai", "signals"]);
    expect(rows.map((r) => r.symbol)).toEqual(["X", "Z", "Y"]);
    expect(rows[2].byPlayer).toEqual({ ai: 200, signals: -100 });
    expect(rows[2].sourcesTotalPln).toBe(100);
    expect(rows[1].sourcesTotalPln).toBe(0);
  });
});
