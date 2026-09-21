import { describe, expect, it } from "vitest";
import { MARKET_ASSETS, assetBySymbol } from "./assets";
import {
  aggregateSentiment,
  heuristicImpact,
  heuristicVerdict,
  matchSymbols,
  type MarketNewsItem,
} from "./news";

const item = (over: Partial<MarketNewsItem>): MarketNewsItem => ({
  guid: Math.random().toString(36),
  title: "t",
  link: "https://example.com",
  source: null,
  publishedAt: "2026-09-19T10:00:00.000Z",
  feedTag: "macro",
  symbols: [],
  impact: "neutral",
  impactScore: 50,
  summaryPl: null,
  classifiedBy: "heuristic",
  ...over,
});

describe("matchSymbols", () => {
  it("matches an instrument by its proper name, in English and Polish", () => {
    expect(matchSymbols("Bitcoin hits a new high", MARKET_ASSETS)).toContain("BTC");
    expect(matchSymbols("Ceny złota rosną trzeci dzień", MARKET_ASSETS)).toContain("XAUUSD");
  });

  it("returns nothing for a macro headline rather than tagging everything", () => {
    // Przypisanie makro-nagłówka do wszystkich instrumentów zamieniłoby
    // panel w szum — pusty wynik znaczy „news ogólnorynkowy".
    expect(matchSymbols("Consumer confidence steady in September", MARKET_ASSETS)).toEqual([]);
  });

  it("does not fire on a substring of an unrelated word", () => {
    // Regresja na oczywistą pułapkę krótkich tickerów: „debt" zawiera „bt",
    // „solar" zawiera „sol". Słownik celowo nie używa gołych skrótów.
    const matched = matchSymbols("Rising government debt and solar subsidies", MARKET_ASSETS);
    expect(matched).not.toContain("SOL");
    expect(matched).not.toContain("BTC");
  });

  it("matches on word boundaries, not on any substring", () => {
    // Realny fałszywy trafik z pierwszego przebiegu na żywych kanałach:
    // „Bitcoin Golden Cross" wylądowało przy złocie, bo „gold" siedzi w
    // „Golden". Teraz „gold" musi być całym słowem.
    const matched = matchSymbols("Bitcoin Golden Cross: what 12 signals show", MARKET_ASSETS);
    expect(matched).toContain("BTC");
    expect(matched).not.toContain("XAUUSD");
    expect(matchSymbols("Gold hits a record high", MARKET_ASSETS)).toContain("XAUUSD");
  });

  it("still matches Polish inflections through the prefix form", () => {
    // „złot*" musi łapać złoto/złota/złotego, choć „gold" jest całym słowem.
    expect(matchSymbols("Cena złota bije rekordy", MARKET_ASSETS)).toContain("XAUUSD");
    expect(matchSymbols("Kurs dolara najwyżej od miesięcy", MARKET_ASSETS)).toContain("USDPLN");
  });

  it("tags a GPW headline for the ETF that stands in for WIG20", () => {
    // ETF na WIG20 TR jest tym, co widzi użytkownik na watchliście domyślnej
    // (sam indeks nie oddaje historii z serwera). Gdyby łapał wyłącznie
    // „wig20tr"/„etfbw20", jego panel newsów byłby pusty przy pełnym
    // strumieniu o warszawskiej giełdzie — te skróty nie padają w nagłówkach.
    expect(matchSymbols("WIG20 zamyka sesję na plusie", MARKET_ASSETS)).toContain("ETFBW20.PL");
    expect(matchSymbols("Mocne otwarcie na GPW", MARKET_ASSETS)).toContain("ETFBW20.PL");
  });

  it("only considers the assets it was handed", () => {
    const onlyGold = [assetBySymbol("XAUUSD")!];
    expect(matchSymbols("Bitcoin and gold both rally", onlyGold)).toEqual(["XAUUSD"]);
  });
});

describe("heuristicImpact", () => {
  it("reads direction from the headline's own vocabulary", () => {
    expect(heuristicImpact("Nvidia beats expectations, stock surges").impact).toBe("bullish");
    expect(heuristicImpact("Apple tumbles after downgrade").impact).toBe("bearish");
  });

  it("says neutral when there is no signal, instead of guessing", () => {
    const verdict = heuristicImpact("Company announces annual shareholder meeting");
    expect(verdict.impact).toBe("neutral");
    expect(verdict.impactScore).toBeLessThan(30);
  });

  it("scores a market-moving topic higher than a routine one", () => {
    const fed = heuristicImpact("Fed signals rate cut as inflation cools");
    const routine = heuristicImpact("Shares rally on new product launch");
    expect(fed.impactScore).toBeGreaterThan(routine.impactScore);
  });

  it("never leaves the 0-100 range", () => {
    const loud = heuristicImpact(
      "Fed war sanction default: stock plunges, crash, selloff, recession, layoffs, downgrade",
    );
    expect(loud.impactScore).toBeGreaterThanOrEqual(0);
    expect(loud.impactScore).toBeLessThanOrEqual(100);
  });
});

describe("heuristicVerdict", () => {
  it("combines direction and instrument matching", () => {
    const verdict = heuristicVerdict("Bitcoin surges to a record high");
    expect(verdict.symbols).toContain("BTC");
    expect(verdict.impact).toBe("bullish");
    expect(verdict.classifiedBy).toBe("heuristic");
  });
});

describe("aggregateSentiment", () => {
  it("weights by impact, so one big story outweighs several small ones", () => {
    const rows = aggregateSentiment([
      item({ symbols: ["BTC"], impact: "bearish", impactScore: 90 }),
      item({ symbols: ["BTC"], impact: "bullish", impactScore: 15 }),
      item({ symbols: ["BTC"], impact: "bullish", impactScore: 15 }),
    ]);
    expect(rows[0].symbol).toBe("BTC");
    expect(rows[0].score).toBeLessThan(0);
    expect(rows[0].items).toBe(3);
  });

  it("counts one headline toward every instrument it names", () => {
    const rows = aggregateSentiment([
      item({ symbols: ["XAUUSD", "XAGUSD"], impact: "bullish", impactScore: 60 }),
    ]);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["XAGUSD", "XAUUSD"]);
    expect(rows[0].score).toBe(100);
  });

  it("returns zero rather than dividing by zero when every item scored 0", () => {
    const rows = aggregateSentiment([
      item({ symbols: ["ETH"], impact: "bullish", impactScore: 0 }),
    ]);
    expect(rows[0].score).toBe(0);
  });

  it("ignores macro items that name no instrument", () => {
    expect(aggregateSentiment([item({ symbols: [] })])).toEqual([]);
  });

  it("sorts by how decisive the sentiment is, not by its sign", () => {
    const rows = aggregateSentiment([
      item({ symbols: ["BTC"], impact: "bullish", impactScore: 20 }),
      item({ symbols: ["BTC"], impact: "bearish", impactScore: 20 }),
      item({ symbols: ["ETH"], impact: "bearish", impactScore: 80 }),
    ]);
    expect(rows[0].symbol).toBe("ETH");
  });
});
