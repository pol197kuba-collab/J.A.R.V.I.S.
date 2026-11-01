import { describe, expect, it } from "vitest";
import type { PricePoint } from "@/lib/markets/series";
import {
  addDays,
  DEFAULT_RULES,
  HORIZON_EXIT_REASON,
  leverageFor,
  MARGIN_CALL_REASON,
  simulate as engineSimulate,
  STOP_LOSS_REASON,
  TAKE_PROFIT_REASON,
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
/** Zasady sprzed krótkiej sprzedaży — do testów mechaniki, która jej nie dotyczy. */
const LONG_ONLY = { allowShort: false };
/** Mechanika bez dźwigni i stopów — testy podstaw nie zależą od nowych reguł ryzyka. */
const BASIC = { maxLeverage: 1, stopSigma: null, takeSigma: null };
const simulate: typeof engineSimulate = (signals, b, o) =>
  engineSimulate(signals, b, { ...o, rules: { ...BASIC, ...o.rules } });
const sig = (s: Partial<FundSignal> & Pick<FundSignal, "symbol" | "madeOn">): FundSignal => ({
  direction: "up",
  confidence: 100,
  reason: "test",
  predictionId: null,
  ...s,
});

describe("targetWeight", () => {
  it("wzrost = 20% × pewność, spadek = krótka 20% × pewność, bez zmian = nie ruszaj", () => {
    const r1 = { ...DEFAULT_RULES, ...BASIC };
    expect(
      targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", confidence: 70 }), r1),
    ).toBeCloseTo(0.14);
    expect(
      targetWeight(
        sig({ symbol: "A", madeOn: "2026-10-01", direction: "down", confidence: 50 }),
        r1,
      ),
    ).toBeCloseTo(-0.1);
    expect(
      targetWeight(sig({ symbol: "A", madeOn: "2026-10-01", direction: "down" }), {
        ...DEFAULT_RULES,
        ...LONG_ONLY,
      }),
    ).toBe(0);
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
      { start, end: addDays(start, 3), rules: LONG_ONLY },
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
      { start, end: addDays(start, 2), rules: LONG_ONLY },
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
      { start, end: addDays(start, 3), rules: LONG_ONLY },
    );
    const day2 = r.trades.filter((t) => t.executedOn === addDays(start, 2));
    expect(day2.map((t) => `${t.side}:${t.symbol}`)).toEqual(["sell:A", "buy:F"]);
    expect(day2[1].notionalPln).toBeGreaterThan(19_000);
  });
});

describe("horyzont i krótka sprzedaż", () => {
  const start = "2026-10-01";
  const flat = (n: number) =>
    series(
      start,
      Array.from({ length: n }, () => 10),
    );

  it("pozycja bez potwierdzenia zamyka się po 7 dniach od prognozy", () => {
    const r = simulate(
      [sig({ symbol: "A", madeOn: start })],
      book({ A: flat(12) }, { A: PLN_EQ }),
      {
        start,
        end: addDays(start, 11),
      },
    );
    expect(r.trades.map((t) => `${t.side}:${t.executedOn}`)).toEqual([
      `buy:${addDays(start, 1)}`,
      `sell:${addDays(start, 7)}`,
    ]);
    expect(r.trades[1].reason).toBe(HORIZON_EXIT_REASON);
    expect(r.trades[1].signalOn).toBe(start);
    expect(r.holdings).toHaveLength(0);
  });

  it("nowa prognoza w tym samym kierunku przedłuża pozycję, „bez zmian” nie", () => {
    const renewed = simulate(
      [sig({ symbol: "A", madeOn: start }), sig({ symbol: "A", madeOn: addDays(start, 5) })],
      book({ A: flat(16) }, { A: PLN_EQ }),
      { start, end: addDays(start, 15) },
    );
    expect(renewed.trades.map((t) => t.executedOn)).toEqual([
      addDays(start, 1),
      addDays(start, 12),
    ]);
    const flatOnly = simulate(
      [
        sig({ symbol: "A", madeOn: start }),
        sig({ symbol: "A", madeOn: addDays(start, 5), direction: "flat" }),
      ],
      book({ A: flat(16) }, { A: PLN_EQ }),
      { start, end: addDays(start, 15) },
    );
    expect(flatOnly.trades.map((t) => t.executedOn)).toEqual([
      addDays(start, 1),
      addDays(start, 7),
    ]);
  });

  it("bez horyzontu (null) pozycja trzyma się do prognozy przeciwnej", () => {
    const r = simulate(
      [sig({ symbol: "A", madeOn: start })],
      book({ A: flat(12) }, { A: PLN_EQ }),
      {
        start,
        end: addDays(start, 11),
        rules: { horizonDays: null },
      },
    );
    expect(r.trades).toHaveLength(1);
  });

  it("spadek otwiera krótką pozycję, która zarabia na spadku ceny", () => {
    const prices = [10, 10, 9, 8, 8, 8, 8, 8, 8, 8];
    const r = simulate(
      [sig({ symbol: "A", madeOn: start, direction: "down" })],
      book({ A: series(start, prices) }, { A: PLN_EQ }),
      { start, end: addDays(start, 9) },
    );
    const [open, cover] = r.trades;
    expect(open.side).toBe("sell");
    expect(open.notionalPln).toBeCloseTo(20_000);
    expect(open.realizedPln).toBeNull();
    expect(cover.side).toBe("buy");
    expect(cover.reason).toBe(HORIZON_EXIT_REASON);
    // −20% ceny na 20 000 zł krótkiej ≈ +4 000 zł minus koszty.
    expect(cover.realizedPln!).toBeGreaterThan(3_900);
    expect(cover.realizedPln!).toBeLessThan(4_000);
    // Opłata za pożyczenie papierów (krótka) też idzie z kapitału.
    expect(r.financingPln).toBeGreaterThan(0);
    expect(r.nav.at(-1)!.navPln).toBeCloseTo(100_000 + cover.realizedPln! - r.financingPln, 2);
  });

  it("w trakcie krótka pozycja jest długiem: wycena maleje, gdy cena rośnie", () => {
    const r = simulate(
      [sig({ symbol: "A", madeOn: start, direction: "down" })],
      book({ A: series(start, [10, 10, 11]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 2) },
    );
    expect(r.holdings[0].units).toBeLessThan(0);
    expect(r.holdings[0].valuePln).toBeLessThan(0);
    // +10% ceny na 20 000 zł krótkiej ≈ −2 000 zł.
    expect(r.nav.at(-1)!.navPln).toBeLessThan(98_000);
    expect(r.nav.at(-1)!.navPln).toBeGreaterThan(97_900);
  });

  it("bez dźwigni: krótkie pozycje blokują gotówkę na nowe kupna", () => {
    const sym = ["A", "B", "C", "D", "E", "F"];
    const closes = Object.fromEntries(sym.map((s) => [s, flat(4)]));
    const inst = Object.fromEntries(sym.map((s) => [s, PLN_EQ]));
    const r = simulate(
      [
        ...["A", "B", "C", "D", "E"].map((s) =>
          sig({ symbol: s, madeOn: start, direction: "down" }),
        ),
        sig({ symbol: "F", madeOn: addDays(start, 1) }),
      ],
      book(closes, inst),
      { start, end: addDays(start, 3) },
    );
    // Pięć krótkich po ~20% wyczerpuje kapitał — kupno F się nie mieści.
    expect(r.trades.filter((t) => t.symbol === "F")).toHaveLength(0);
    expect(r.trades.filter((t) => t.side === "sell")).toHaveLength(5);
  });
});

describe("dźwignia i ryzyko", () => {
  const start = "2026-10-01";

  it("dźwignia rośnie z pewnością: 1× do 60%, 2× przy 100%", () => {
    expect(leverageFor(0.5)).toBe(1);
    expect(leverageFor(0.6)).toBe(1);
    expect(leverageFor(0.8)).toBeCloseTo(1.5);
    expect(leverageFor(1)).toBe(2);
    expect(targetWeight(sig({ symbol: "A", madeOn: start, confidence: 100 }))).toBeCloseTo(0.4);
    expect(targetWeight(sig({ symbol: "A", madeOn: start, confidence: 50 }))).toBeCloseTo(0.1);
  });

  it("łączna ekspozycja nie przekracza 2× kapitału, pożyczona gotówka kosztuje", () => {
    const sym = ["A", "B", "C", "D", "E", "F"];
    const closes = Object.fromEntries(
      sym.map((s) => [
        s,
        series(
          start,
          Array.from({ length: 6 }, () => 10),
        ),
      ]),
    );
    const inst = Object.fromEntries(sym.map((s) => [s, PLN_EQ]));
    const r = engineSimulate(
      sym.map((s) => sig({ symbol: s, madeOn: start })),
      book(closes, inst),
      { start, end: addDays(start, 5), rules: { stopSigma: null, takeSigma: null } },
    );
    const bought = r.trades.reduce((s, t) => s + t.notionalPln, 0);
    expect(bought).toBeGreaterThan(195_000);
    expect(bought).toBeLessThanOrEqual(200_000);
    expect(r.cashPln).toBeLessThan(0);
    expect(r.financingPln).toBeGreaterThan(0);
  });

  it("margin call zamyka wszystko, gdy kapitał spada poniżej depozytu", () => {
    const sym = ["A", "B", "C", "D", "E"];
    // Po wejściu ceny spadają o 45% — przy 2× ekspozycji kapitał topnieje.
    const path = [10, 10, 10, 5.5, 5.5, 5.5];
    const closes = Object.fromEntries(sym.map((s) => [s, series(start, path)]));
    const inst = Object.fromEntries(sym.map((s) => [s, PLN_EQ]));
    const r = engineSimulate(
      sym.map((s) => sig({ symbol: s, madeOn: start })),
      book(closes, inst),
      { start, end: addDays(start, 5), rules: { stopSigma: null, takeSigma: null } },
    );
    const forced = r.trades.filter((t) => t.reason === MARGIN_CALL_REASON);
    expect(forced.length).toBe(5);
    expect(forced[0].executedOn).toBe(addDays(start, 3));
    expect(r.exits.marginCall).toBe(5);
    expect(r.holdings).toHaveLength(0);
  });

  it("stop-loss i take-profit liczone od zmienności instrumentu", () => {
    // Spokojna historia (σ ≈ 1%), potem wejście i ruch o kilka σ.
    const calm = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
    const down = engineSimulate(
      [sig({ symbol: "A", madeOn: addDays(start, 9) })],
      book({ A: series(start, [...calm, 95, 95]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 12) },
    );
    expect(down.trades.map((t) => t.reason)).toEqual(["test", STOP_LOSS_REASON]);
    expect(down.trades[1].realizedPln!).toBeLessThan(0);
    const up = engineSimulate(
      [sig({ symbol: "A", madeOn: addDays(start, 9) })],
      book({ A: series(start, [...calm, 106, 106]) }, { A: PLN_EQ }),
      { start, end: addDays(start, 12) },
    );
    expect(up.trades.map((t) => t.reason)).toEqual(["test", TAKE_PROFIT_REASON]);
    expect(up.exits.takeProfit).toBe(1);
  });

  it("horyzont 2 dni dla akcji liczony w sesjach: prognoza z piątku kończy się w poniedziałek", async () => {
    const { horizonEnd } = await import("./engine");
    expect(horizonEnd("2026-10-02", 2, "equity")).toBe("2026-10-05");
    expect(horizonEnd("2026-10-02", 2, "crypto")).toBe("2026-10-04");
    expect(horizonEnd("2026-10-01", 7, "equity")).toBe("2026-10-08");
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
    const pred = (
      id: string,
      source: string,
      symbol: string,
      day: number,
      direction: string,
      horizon_days = 2,
    ) => ({
      horizon_days,
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
        pred("6", "ai", "CDR.PL", 0, "up", 7),
      ],
      closes,
      addDays(start, 5),
    )!;
    expect(run.start).toBe(start);
    expect(run.players.map((p) => p.key)).toEqual([
      "ai_learned",
      "ai",
      "signals",
      "ai_7d",
      "basket",
      "monkey",
    ]);
    const ai = run.players.find((p) => p.key === "ai")!;
    // Horyzont 2 dni zamyka długą, potem „spadek” otwiera krótką.
    expect(ai.result.trades.map((t) => `${t.side}:${t.symbol}:${t.predictionId}`)).toEqual([
      "buy:BTC:1",
      "sell:BTC:1",
      "sell:BTC:3",
      "buy:BTC:3",
    ]);
    // Kontrola 7 dni gra tylko prognozy 7-dniowe tego samego modelu.
    const control = run.players.find((p) => p.key === "ai_7d")!;
    expect(control.result.trades.map((t) => t.predictionId)).toEqual(["6"]);
    expect(ai.result.trades[1].realizedPln).not.toBeNull();
    expect(ai.result.trades[2].realizedPln).toBeNull();
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
          horizon_days: 2,
        },
      ],
      new Map([["CDR.PL", series(start, [10, 10.37, 11])]]),
      addDays(start, 2),
    )!;
    const ids = new Map(run.players.map((p) => [p.key, `id-${p.key}`]));
    const rows = fundRows(run, "u1", ids);
    const aiOrders = rows.orders.filter((o) => o.portfolio_id === "id-ai");
    // Kupno + zamknięcie po horyzoncie (1 sesja dla akcji).
    expect(aiOrders).toHaveLength(2);
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
    // Pozycja zamknięta po horyzoncie — pozycje ma tylko koszyk.
    expect(rows.positions.filter((p) => p.portfolio_id === "id-ai")).toHaveLength(0);
    expect(rows.positions.filter((p) => p.portfolio_id === "id-basket")[0].as_of).toBe(
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

describe("fundVerdict", () => {
  it("ostrzega przy krótkiej historii i porównuje z koszykiem i małpą", async () => {
    const { fundVerdict } = await import("./verdict");
    const lines = fundVerdict(
      [
        { key: "ai", label: "AI", kind: "source", returnPct: 2.5 },
        { key: "signals", label: "Sygnały", kind: "source", returnPct: -1 },
        { key: "basket", label: "Koszyk", kind: "benchmark", returnPct: 1 },
        { key: "monkey", label: "Małpa", kind: "monkey", returnPct: -0.5 },
      ],
      5,
    );
    expect(lines[0]).toMatch(/Za wcześnie na wnioski: 5 dni/);
    expect(lines[1]).toBe("Prowadzi: AI (+2,50%).");
    expect(lines).toContain("AI: bije koszyk (+1,5 pp), bije małpę (+3,0 pp).");
    expect(lines).toContain(
      "Sygnały: przegrywa z koszykiem (−2,0 pp), przegrywa z małpą (−0,5 pp).",
    );
    expect(fundVerdict([], 30)).toEqual([]);
    expect(fundVerdict([{ key: "ai", label: "AI", kind: "source", returnPct: 1 }], 30)[0]).toMatch(
      /^Prowadzi/,
    );
  });

  it("gracz bez prognoz nie gra: poza rankingiem i z jasnym powodem", async () => {
    const { fundVerdict, isWaiting } = await import("./verdict");
    const lines = fundVerdict(
      [
        { key: "ai_learned", label: "AI z wnioskami", kind: "source", returnPct: 0, waiting: true },
        { key: "ai", label: "AI", kind: "source", returnPct: -2 },
        { key: "basket", label: "Koszyk", kind: "benchmark", returnPct: -1 },
      ],
      30,
    );
    expect(lines[0]).toBe("Prowadzi: Koszyk (−1,00%).");
    expect(lines).toContain(
      "AI z wnioskami: jeszcze nie gra — czeka na wnioski z rozliczonych prognoz.",
    );
    expect(isWaiting({ kind: "source", metrics: { trades: 0, signals: 0 } })).toBe(true);
    // prognozy są, ale wszystkie „bez zmian” — gra, tylko stoi w gotówce
    expect(isWaiting({ kind: "source", metrics: { trades: 0, signals: 12 } })).toBe(false);
    // stary portfel bez licznika: zero transakcji = nie gra
    expect(isWaiting({ kind: "source", metrics: { trades: 0 } })).toBe(true);
    expect(isWaiting({ kind: "benchmark", metrics: { trades: 0, signals: 0 } })).toBe(false);
  });
});

describe("zdarzenia na żywo", () => {
  const start = "2026-10-01";
  const flat10 = (n: number) =>
    series(
      start,
      Array.from({ length: n }, () => 10),
    );
  const live = (s: Partial<FundSignal>) =>
    sig({ symbol: "A", madeOn: start, madeAt: `${start}T18:30:00Z`, ...s });

  it("fill: prognoza realizuje się po cenie z ciągu dnia, tego samego dnia po jej postawieniu", () => {
    const r = engineSimulate([live({})], book({ A: flat10(4) }, { A: PLN_EQ }), {
      start,
      end: addDays(start, 3),
      rules: BASIC,
      events: [{ at: `${start}T18:45:00Z`, symbol: "A", kind: "fill", price: 9, signalOn: start }],
    });
    expect(r.trades[0].executedOn).toBe(start);
    expect(r.trades[0].price).toBeCloseTo(9 * (1 + DEFAULT_RULES.spreadByClass.equity / 2));
    // Już zrealizowana — nie wchodzi drugi raz po zamknięciu.
    expect(r.trades.filter((t) => t.side === "buy")).toHaveLength(1);
  });

  it("fill sprzed chwili postawienia prognozy jest ignorowany (bez zaglądania w przyszłość)", () => {
    const r = engineSimulate([live({})], book({ A: flat10(3) }, { A: PLN_EQ }), {
      start,
      end: addDays(start, 2),
      rules: BASIC,
      events: [{ at: `${start}T10:00:00Z`, symbol: "A", kind: "fill", price: 5, signalOn: start }],
    });
    expect(r.trades[0].executedOn).toBe(addDays(start, 1));
    expect(r.trades[0].price).toBeGreaterThan(9.9);
  });

  it("stop w trakcie sesji zamyka po cenie zdarzenia; stan końcowy podaje pozycje i kolejkę", () => {
    const r = engineSimulate([live({})], book({ A: flat10(4) }, { A: PLN_EQ }), {
      start,
      end: addDays(start, 3),
      rules: BASIC,
      events: [
        {
          at: `${addDays(start, 2)}T11:00:00Z`,
          symbol: "A",
          kind: "stop",
          price: 9.5,
          side: "long",
        },
      ],
    });
    const stop = r.trades.find((t) => t.side === "sell")!;
    expect(stop.executedOn).toBe(addDays(start, 2));
    expect(stop.price).toBeCloseTo(9.5 * (1 - DEFAULT_RULES.spreadByClass.equity / 2));
    expect(r.exits.stopLoss).toBe(1);
    expect(r.live).toHaveLength(0);

    const open = engineSimulate(
      [live({}), live({ symbol: "B", madeOn: addDays(start, 3) })],
      book({ A: flat10(4), B: flat10(4) }, { A: PLN_EQ, B: PLN_EQ }),
      { start, end: addDays(start, 3), rules: BASIC },
    );
    expect(open.live.map((l) => [l.symbol, l.side])).toEqual([["A", "long"]]);
    expect(open.pending.map((p) => p.symbol)).toEqual(["B"]);
  });

  it("alarm zamyka tylko pozycję po wskazanej stronie", () => {
    const run = (side: "long" | "short") =>
      engineSimulate([live({})], book({ A: flat10(4) }, { A: PLN_EQ }), {
        start,
        end: addDays(start, 3),
        rules: BASIC,
        events: [
          {
            at: `${addDays(start, 2)}T09:00:00Z`,
            symbol: "A",
            kind: "alarm",
            price: 10,
            side,
            reason: "Alarm AI: test",
          },
        ],
      });
    expect(run("long").trades.at(-1)!.reason).toBe("Alarm AI: test");
    expect(run("long").exits.alarm).toBe(1);
    expect(run("short").exits.alarm).toBe(0);
  });
});

describe("werdykt — gracz na starcie", () => {
  it("gracz z czekającymi zleceniami nie „prowadzi” i nie „bije koszyka” wynikiem 0%", async () => {
    const { fundVerdict, startingWith } = await import("./verdict");
    expect(startingWith({ kind: "source", metrics: { trades: 0, pending: 13 } })).toBe(13);
    expect(startingWith({ kind: "source", metrics: { trades: 5, pending: 13 } })).toBe(0);
    const lines = fundVerdict(
      [
        { key: "ai", label: "AI", kind: "source", returnPct: 0, startingWith: 13 },
        { key: "ai_7d", label: "AI 7d", kind: "source", returnPct: -1 },
        { key: "basket", label: "Koszyk", kind: "benchmark", returnPct: -10 },
      ],
      40,
    );
    expect(lines[0]).toBe("Prowadzi: AI 7d (−1,00%).");
    expect(lines).toContain("AI: dopiero zaczyna — 13 zleceń czeka na realizację.");
  });
});

describe("odczyt prognoz funduszu", () => {
  it("pobiera made_at — bez niego nic nie realizuje się na żywo", async () => {
    const { PREDICTION_COLUMNS } = await import("./fund.server");
    expect(PREDICTION_COLUMNS.split(",").map((c) => c.trim())).toEqual(
      expect.arrayContaining(["made_at", "horizon_days", "stale", "made_on"]),
    );
  });
});
