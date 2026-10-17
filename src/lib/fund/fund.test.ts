import { describe, expect, it } from "vitest";
import type { PricePoint } from "@/lib/markets/series";
import {
  addDays,
  DEFAULT_RULES,
  simulate,
  targetWeight,
  type FundSignal,
  type Instrument,
  type PriceBook,
} from "./engine";
import { computeMetrics } from "./metrics";
import { basketSignals, monkeySignals } from "./players";

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

function series(start: string, closes: number[]): PricePoint[] {
  return closes.map((close, i) => ({ date: addDays(start, i), close }));
}

function book(
  closes: Record<string, PricePoint[]>,
  instruments: Record<string, Instrument>,
): PriceBook {
  return {
    closes: new Map(Object.entries(closes)),
    instruments: new Map(Object.entries(instruments)),
  };
}

const PLN_EQ: Instrument = { assetClass: "equity", currency: "PLN" };
const sig = (s: Partial<FundSignal> & Pick<FundSignal, "symbol" | "madeOn">): FundSignal => ({
  direction: "up",
  confidence: 100,
  reason: "test",
  predictionId: null,
  ...s,
});

describe("targetWeight", () => {
  it("wzrost = 20% × pewność, spadek = 0, bez zmian = nie ruszaj", () => {
    expect(targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", confidence: 70 }))).toBeCloseTo(
      0.14,
    );
    expect(targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", direction: "down" }))).toBe(0);
    expect(targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", direction: "flat" }))).toBeNull();
    expect(targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", weight: 0.5 }))).toBe(0.2);
  });
});

describe("simulate", () => {
  const start = "2026-10-01";

  it("bez prognoz NAV = gotówka przez cały czas", () => {
    const r = simulate([], book({ A: series(start, [10, 11, 12]) }, { A: PLN_EQ }), {
      start,
      end: addDays(start, 2),
    });
    expect(r.nav.map((p) => p.navPln)).toEqual([100_000, 100_000, 100_000]);
    expect(r.trades).toHaveLength(0);
  });

  it("realizacja po KOLEJNYM zamknięciu, nigdy po cenie z dnia prognozy", () => {
    const r = simulate(
      [sig({ symbol: "A", madeOn: start })],
      book({ A: series(start, [10, 20, 30]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 2) },
    );
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].executedOn).toBe(addDays(start, 1));
    // Cena 20 (zamknięcie dnia następnego) + połowa spreadu, nie 10.
    expect(r.trades[0].price).toBeCloseTo(20 * (1 + DEFAULT_RULES.spreadByClass.equity / 2));
  });

  it("czeka na najbliższą sesję, gdy dzień po prognozie jest bez notowań", () => {
    const closes = [
      { date: "2026-10-02", close: 10 }, // piątek
      { date: "2026-10-05", close: 12 }, // poniedziałek
    ];
    const r = simulate(
      [sig({ symbol: "A", madeOn: "2026-10-02" })],
      book({ A: closes }, { A: PLN_EQ }),
      { start: "2026-10-02", end: "2026-10-06" },
    );
    expect(r.trades[0].executedOn).toBe("2026-10-05");
  });

  it("limit 20% i koszty: kupno + sprzedaż po tej samej cenie kosztuje spread i prowizję", () => {
    const r = simulate(
      [
        sig({ symbol: "A", madeOn: start }),
        sig({ symbol: "A", madeOn: addDays(start, 1), direction: "down" }),
      ],
      book({ A: series(start, [10, 10, 10, 10]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 3) },
    );
    const [buy, sell] = r.trades;
    expect(buy.notionalPln).toBeCloseTo(20_000);
    expect(sell.side).toBe("sell");
    const lost = 100_000 - r.cashPln;
    const expected = 20_000 * (0.001 + 0.0005) + 20_000 * (0.0005 + 0.001);
    expect(lost).toBeGreaterThan(expected * 0.9);
    expect(lost).toBeLessThan(expected * 1.1);
    expect(sell.realizedPln!).toBeLessThan(0);
    expect(r.holdings).toHaveLength(0);
  });

  it("bez krótkiej sprzedaży: spadek bez pozycji nic nie robi", () => {
    const r = simulate(
      [sig({ symbol: "A", madeOn: start, direction: "down" })],
      book({ A: series(start, [10, 8, 6]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 2) },
    );
    expect(r.trades).toHaveLength(0);
    expect(r.nav.at(-1)!.navPln).toBe(100_000);
  });

  it("instrument w USD wyceniany po USDPLN z tej samej bazy", () => {
    const r = simulate(
      [sig({ symbol: "NVDA.US", madeOn: start })],
      book(
        {
          "NVDA.US": series(start, [100, 100, 110]),
          USDPLN: series(start, [4, 4, 4]),
        },
        {
          "NVDA.US": { assetClass: "equity", currency: "USD" },
          USDPLN: { assetClass: "fx", currency: "PLN" },
        },
      ),
      { start, end: addDays(start, 2) },
    );
    expect(r.trades[0].fxRate).toBe(4);
    // +10% na 20% portfela ≈ +2% NAV (minus koszty kupna).
    const navEnd = r.nav.at(-1)!.navPln;
    expect(navEnd).toBeGreaterThan(101_900);
    expect(navEnd).toBeLessThan(102_000);
  });

  it("„bez zmian” anuluje czekające zlecenie, nowsza prognoza zastępuje starszą", () => {
    const b = book({ A: series(start, [10, 10, 10]) }, { A: PLN_EQ });
    const cancelled = simulate(
      [sig({ symbol: "A", madeOn: start }), sig({ symbol: "A", madeOn: start, direction: "flat" })],
      b,
      { start, end: addDays(start, 2) },
    );
    expect(cancelled.trades).toHaveLength(0);
  });

  it("sprzedaże przed kupnami — zwolniona gotówka wystarcza na nowe pozycje", () => {
    // Pięć pozycji po 20% = 100% portfela; potem sprzedaż A i kupno F tego samego dnia.
    const sym = ["A", "B", "C", "D", "E", "F"];
    const closes = Object.fromEntries(sym.map((s) => [s, series(start, [10, 10, 10, 10])]));
    const inst = Object.fromEntries(sym.map((s) => [s, PLN_EQ]));
    const r = simulate(
      [
        ...["A", "B", "C", "D", "E"].map((s) => sig({ symbol: s, madeOn: start })),
        sig({ symbol: "A", madeOn: addDays(start, 1), direction: "down" }),
        sig({ symbol: "F", madeOn: addDays(start, 1) }),
      ],
      book(closes, inst),
      { start, end: addDays(start, 3) },
    );
    const day2 = r.trades.filter((t) => t.executedOn === addDays(start, 2));
    expect(day2.map((t) => `${t.side}:${t.symbol}`)).toEqual(["sell:A", "buy:F"]);
    expect(day2[1].notionalPln).toBeGreaterThan(19_000);
  });
});

describe("metryki", () => {
  it("zwrot, obsunięcie, obrót", () => {
    const nav = [100_000, 110_000, 99_000, 105_000].map((v, i) => ({
      date: addDays("2026-10-01", i),
      navPln: v,
      cashPln: v,
      investedPln: 0,
    }));
    const m = computeMetrics(nav, [], 100_000);
    expect(m.returnPct).toBeCloseTo(5);
    expect(m.maxDrawdownPct).toBeCloseTo(-10);
    expect(m.sharpe).toBeNull(); // za mało dni
    expect(m.turnover).toBe(0);
  });

  it("Sharpe przy stałym wzroście jest dodatni, przy zerowej zmienności null", () => {
    const grow = days("2026-10-01", 20).map((date, i) => ({
      date,
      navPln: 100_000 * (1 + 0.001 * i + (i % 2) * 0.0005),
      cashPln: 0,
      investedPln: 0,
    }));
    expect(computeMetrics(grow, [], 100_000).sharpe!).toBeGreaterThan(0);
    const flat = days("2026-10-01", 20).map((date) => ({
      date,
      navPln: 100_000,
      cashPln: 0,
      investedPln: 0,
    }));
    expect(computeMetrics(flat, [], 100_000).sharpe).toBeNull();
  });
});

describe("gracze odniesienia", () => {
  it("koszyk: po równo, kup i trzymaj", () => {
    const s = basketSignals(["B", "A", "A", "C", "D", "E", "F", "G", "H"], "2026-10-01");
    expect(s).toHaveLength(8);
    expect(s[0].weight).toBeCloseTo(1 / 8);
  });

  it("małpa: deterministyczna i tylko na podanych instrumentach", () => {
    const sd = days("2026-10-01", 30).flatMap((day) =>
      ["A", "B"].map((symbol) => ({ symbol, day })),
    );
    const a = monkeySignals(sd);
    expect(monkeySignals(sd)).toEqual(a);
    expect(a.length).toBeGreaterThan(10);
    expect(a.length).toBeLessThan(40);
    expect(new Set(a.map((s) => s.symbol))).toEqual(new Set(["A", "B"]));
  });
});

describe("buildFund", () => {
  it("wszyscy gracze od pierwszej prognozy, każdy na swoich prognozach", async () => {
    const { buildFund } = await import("./fund");
    const start = "2026-10-01";
    const closes = new Map([
      ["BTC", series(start, [100, 105, 110, 108, 112, 115])],
      ["CDR.PL", series(start, [50, 49, 48, 50, 51, 52])],
      ["USDPLN", series(start, [4, 4, 4, 4, 4, 4])],
    ]);
    const pred = (id: string, source: string, symbol: string, day: number, direction: string) => ({
      id,
      source,
      symbol,
      made_on: addDays(start, day),
      direction,
      confidence: 80,
      rationale_pl: `${source} ${direction}`,
    });
    const run = buildFund(
      [
        pred("1", "ai", "BTC", 0, "up"),
        pred("2", "signals", "CDR.PL", 1, "up"),
        pred("3", "ai", "BTC", 3, "down"),
        pred("4", "unknown_src", "BTC", 0, "up"),
        pred("5", "ai", "NIEZNANY", 0, "up"),
      ],
      closes,
      addDays(start, 5),
    )!;
    expect(run.start).toBe(start);
    expect(run.players.map((p) => p.key)).toEqual([
      "ai_learned",
      "ai",
      "signals",
      "basket",
      "monkey",
    ]);
    const ai = run.players.find((p) => p.key === "ai")!;
    expect(ai.result.trades.map((t) => `${t.side}:${t.symbol}:${t.predictionId}`)).toEqual([
      "buy:BTC:1",
      "sell:BTC:3",
    ]);
    expect(ai.result.trades[0].reason).toBe("ai up");
    const learned = run.players.find((p) => p.key === "ai_learned")!;
    expect(learned.result.trades).toHaveLength(0);
    expect(learned.metrics.returnPct).toBe(0);
    const basket = run.players.find((p) => p.key === "basket")!;
    expect(new Set(basket.result.trades.map((t) => t.symbol))).toEqual(new Set(["BTC", "CDR.PL"]));
  });

  it("brak prognoz — null", async () => {
    const { buildFund } = await import("./fund");
    expect(buildFund([], new Map(), "2026-10-05")).toBeNull();
  });
});

describe("fundRows", () => {
  it("mapuje wynik na wiersze tabel, PLN zaokrąglone do groszy", async () => {
    const { buildFund } = await import("./fund");
    const { fundRows } = await import("./fund.server");
    const start = "2026-10-01";
    const run = buildFund(
      [
        {
          id: "p1",
          source: "ai",
          symbol: "CDR.PL",
          made_on: start,
          direction: "up",
          confidence: 73,
          rationale_pl: "powód",
        },
      ],
      new Map([["CDR.PL", series(start, [10, 10.37, 11])]]),
      addDays(start, 2),
    )!;
    const ids = new Map(run.players.map((p) => [p.key, `id-${p.key}`]));
    const rows = fundRows(run, "u1", ids);
    const aiOrders = rows.orders.filter((o) => o.portfolio_id === "id-ai");
    expect(aiOrders).toHaveLength(1);
    expect(aiOrders[0]).toMatchObject({
      owner_id: "u1",
      side: "buy",
      prediction_id: "p1",
      reason: "powód",
      signal_on: start,
      executed_on: addDays(start, 1),
      confidence: 73,
    });
    expect(Number.isInteger(aiOrders[0].notional_pln * 100)).toBe(true);
    // Wycena: dzień po dniu dla każdego z 5 graczy.
    expect(rows.nav.filter((n) => n.portfolio_id === "id-ai")).toHaveLength(3);
    expect(rows.positions.filter((p) => p.portfolio_id === "id-ai")[0].as_of).toBe(
      addDays(start, 2),
    );
    // Gracz bez id portfela (np. błąd upsertu) — pominięty, nie wywraca reszty.
    expect(fundRows(run, "u1", new Map()).orders).toHaveLength(0);
  });
});

describe("pasmo tolerancji", () => {
  it("drobna zmiana pewności nie dokupuje (mniej niż 2% portfela)", () => {
    const start = "2026-10-01";
    const r = simulate(
      [
        sig({ symbol: "A", madeOn: start, confidence: 65 }),
        sig({ symbol: "A", madeOn: addDays(start, 1), confidence: 70 }),
        sig({ symbol: "A", madeOn: addDays(start, 2), confidence: 100 }),
      ],
      book({ A: series(start, [10, 10, 10, 10]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 3) },
    );
    // 13% → 14% pominięte (1 pp), 14% → 20% wykonane (6 pp).
    expect(r.trades.map((t) => t.executedOn)).toEqual([addDays(start, 1), addDays(start, 3)]);
  });
});
