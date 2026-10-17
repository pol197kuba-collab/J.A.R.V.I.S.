// FUNDUSZ J.A.R.V.I.S. (PLAN.md, S3.1) — silnik portfela na papierze.
// Czysta logika, bez I/O: wejście = prognozy gracza + kursy zamknięcia,
// wyjście = transakcje, dzienna wycena (NAV) i stan pozycji.
//
// ZASADY (uczciwość ponad wszystko):
// - Start 100 000 PLN, wycena w PLN po kursie USDPLN/EURPLN z tej samej bazy.
// - Realizacja po KOLEJNYM zamknięciu: prognoza z dnia D wchodzi po cenie
//   zamknięcia pierwszego notowania z datą > D. Nigdy po cenie, którą
//   prognoza już znała.
// - Koszty: prowizja od wartości transakcji + połowa spreadu przy każdej
//   stronie (kupno drożej, sprzedaż taniej), spread zależny od klasy aktywów.
// - Najwyżej 20% portfela w jednym instrumencie (przy składaniu zlecenia),
//   bez krótkiej sprzedaży, bez dźwigni (kupno tylko za posiadaną gotówkę).
// - Wielkość pozycji: „wzrost” → cel = 20% × pewność; „spadek” → sprzedaj
//   całość; „bez zmian” → trzymaj, nie dokupuj (i anuluj czekające zlecenie).
// - Drobne korekty (< MIN_TRADE_PLN) są pomijane — inaczej codzienne
//   wahania pewności mieliłyby prowizję.
//
// Całą historię liczymy od nowa przy każdym przebiegu (to kilkanaście
// instrumentów × kilkadziesiąt dni): zmiana zasad działa wstecz spójnie,
// a stan nie może się „rozjechać” między przebiegami.

import type { AssetClass } from "@/lib/markets/assets";
import type { PricePoint } from "@/lib/markets/series";

export type Direction = "up" | "down" | "flat";

export type FundSignal = {
  symbol: string;
  /** Dzień prognozy (YYYY-MM-DD, UTC) — realizacja najwcześniej dzień później. */
  madeOn: string;
  direction: Direction;
  /** 0–100. */
  confidence: number;
  /** Uzasadnienie prognozy — trafia do historii transakcji. */
  reason: string | null;
  predictionId: string | null;
  /** Cel wprost (ułamek portfela) — dla benchmarku; nadpisuje regułę pewności. */
  weight?: number;
};

export type FundRules = {
  startCashPln: number;
  maxWeight: number;
  minTradePln: number;
  commissionRate: number;
  /** Pełny spread (kupno–sprzedaż) jako ułamek ceny, per klasa aktywów. */
  spreadByClass: Record<AssetClass, number>;
};

export const DEFAULT_RULES: FundRules = {
  startCashPln: 100_000,
  maxWeight: 0.2,
  minTradePln: 500,
  // Typowa prowizja polskiego brokera na rynkach zagranicznych / krypto-giełdy.
  commissionRate: 0.001,
  spreadByClass: {
    crypto: 0.002,
    equity: 0.001,
    index: 0.001,
    commodity: 0.0008,
    fx: 0.0004,
  },
};

export type Instrument = { assetClass: AssetClass; currency: string };

export type PriceBook = {
  /** Zamknięcia per symbol (dowolna kolejność — silnik sortuje). */
  closes: Map<string, PricePoint[]>;
  instruments: Map<string, Instrument>;
};

export type Trade = {
  symbol: string;
  side: "buy" | "sell";
  units: number;
  /** Cena realizacji w walucie instrumentu (ze spreadem). */
  price: number;
  /** Kurs waluty → PLN użyty przy realizacji (1 dla PLN). */
  fxRate: number;
  /** Wartość transakcji w PLN, bez prowizji. */
  notionalPln: number;
  feePln: number;
  /** Zysk/strata zrealizowana w PLN (tylko sprzedaż, po kosztach). */
  realizedPln: number | null;
  signalOn: string;
  executedOn: string;
  predictionId: string | null;
  reason: string | null;
  direction: Direction;
  confidence: number;
};

export type NavPoint = { date: string; navPln: number; cashPln: number; investedPln: number };

export type Holding = { symbol: string; units: number; costPln: number; valuePln: number };

export type SimResult = { trades: Trade[]; nav: NavPoint[]; holdings: Holding[]; cashPln: number };

// ---------- daty ----------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- kursy ----------

class Prices {
  private series = new Map<string, PricePoint[]>();
  private exact = new Map<string, Map<string, number>>();

  constructor(closes: Map<string, PricePoint[]>) {
    for (const [symbol, points] of closes) {
      const sorted = points
        .filter((p) => Number.isFinite(p.close) && p.close > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      this.series.set(symbol, sorted);
      this.exact.set(symbol, new Map(sorted.map((p) => [p.date, p.close])));
    }
  }

  /** Zamknięcie dokładnie z danego dnia (dzień sesyjny) albo null. */
  on(symbol: string, date: string): number | null {
    return this.exact.get(symbol)?.get(date) ?? null;
  }

  /** Ostatnie zamknięcie z datą ≤ date (wycena w dni bez sesji). */
  atOrBefore(symbol: string, date: string): number | null {
    const s = this.series.get(symbol);
    if (!s || s.length === 0 || s[0].date > date) return null;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].date <= date) lo = mid;
      else hi = mid - 1;
    }
    return s[lo].close;
  }
}

const FX_SYMBOL: Record<string, string> = { USD: "USDPLN", EUR: "EURPLN" };

function fxToPln(prices: Prices, currency: string, date: string): number | null {
  if (currency === "PLN") return 1;
  const pair = FX_SYMBOL[currency];
  return pair ? prices.atOrBefore(pair, date) : null;
}

/** Docelowy udział w portfelu albo null = nie ruszaj pozycji. */
export function targetWeight(signal: FundSignal, rules: FundRules = DEFAULT_RULES): number | null {
  if (signal.weight !== undefined) return Math.min(rules.maxWeight, Math.max(0, signal.weight));
  if (signal.direction === "down") return 0;
  if (signal.direction === "flat") return null;
  const c = Math.min(100, Math.max(0, signal.confidence)) / 100;
  return rules.maxWeight * c;
}

// ---------- symulacja ----------

export function simulate(
  signals: FundSignal[],
  book: PriceBook,
  opts: { start: string; end: string; rules?: Partial<FundRules> },
): SimResult {
  const rules: FundRules = { ...DEFAULT_RULES, ...opts.rules };
  const prices = new Prices(book.closes);
  const bySignalDay = new Map<string, FundSignal[]>();
  for (const s of signals) {
    if (!book.instruments.has(s.symbol)) continue;
    const list = bySignalDay.get(s.madeOn) ?? [];
    list.push(s);
    bySignalDay.set(s.madeOn, list);
  }

  let cash = rules.startCashPln;
  const holdings = new Map<string, { units: number; costPln: number }>();
  const pending = new Map<string, FundSignal>();
  const trades: Trade[] = [];
  const nav: NavPoint[] = [];

  const valueOf = (symbol: string, units: number, date: string): number => {
    const inst = book.instruments.get(symbol);
    const px = prices.atOrBefore(symbol, date);
    const fx = inst ? fxToPln(prices, inst.currency, date) : null;
    return px !== null && fx !== null ? units * px * fx : 0;
  };
  const navAt = (date: string): number => {
    let total = cash;
    for (const [symbol, h] of holdings) total += valueOf(symbol, h.units, date);
    return total;
  };

  const execute = (signal: FundSignal, date: string, target: number): void => {
    const inst = book.instruments.get(signal.symbol)!;
    const px = prices.on(signal.symbol, date)!;
    const fx = fxToPln(prices, inst.currency, date);
    if (fx === null) return;
    const half = rules.spreadByClass[inst.assetClass] / 2;
    const held = holdings.get(signal.symbol) ?? { units: 0, costPln: 0 };
    const current = held.units * px * fx;
    const delta = target * navAt(date) - current;
    const base = {
      symbol: signal.symbol,
      fxRate: fx,
      signalOn: signal.madeOn,
      executedOn: date,
      predictionId: signal.predictionId,
      reason: signal.reason,
      direction: signal.direction,
      confidence: signal.confidence,
    };

    if (delta > 0) {
      // Kupno tylko za gotówkę, z miejscem na prowizję.
      const budget = Math.min(delta, cash / (1 + rules.commissionRate));
      if (budget < rules.minTradePln) return;
      const price = px * (1 + half);
      const units = budget / (price * fx);
      const fee = budget * rules.commissionRate;
      cash -= budget + fee;
      holdings.set(signal.symbol, {
        units: held.units + units,
        costPln: held.costPln + budget + fee,
      });
      trades.push({
        ...base,
        side: "buy",
        units,
        price,
        notionalPln: budget,
        feePln: fee,
        realizedPln: null,
      });
    } else if (delta < 0 && held.units > 0) {
      const sellAll = target === 0;
      if (!sellAll && -delta < rules.minTradePln) return;
      const units = sellAll ? held.units : Math.min(held.units, -delta / (px * fx));
      const price = px * (1 - half);
      const proceeds = units * price * fx;
      const fee = proceeds * rules.commissionRate;
      const costShare = held.costPln * (units / held.units);
      cash += proceeds - fee;
      const left = held.units - units;
      if (left <= held.units * 1e-9) holdings.delete(signal.symbol);
      else holdings.set(signal.symbol, { units: left, costPln: held.costPln - costShare });
      trades.push({
        ...base,
        side: "sell",
        units,
        price,
        notionalPln: proceeds,
        feePln: fee,
        realizedPln: proceeds - fee - costShare,
      });
    }
  };

  for (let date = opts.start; date <= opts.end; date = addDays(date, 1)) {
    // 1. Realizacja czekających zleceń na dzisiejszym zamknięciu — najpierw
    //    sprzedaże (zwalniają gotówkę), potem kupna; w obrębie strony stała
    //    kolejność symboli, żeby wynik nie zależał od kolejności wejścia.
    const today = navAt(date);
    const ready = [...pending.values()]
      .filter((s) => s.madeOn < date && prices.on(s.symbol, date) !== null)
      .map((s) => {
        const target = targetWeight(s, rules)!;
        const units = holdings.get(s.symbol)?.units ?? 0;
        // Ujemna zmiana = sprzedaż (także częściowa redukcja).
        return { s, target, change: target * today - valueOf(s.symbol, units, date) };
      });
    ready.sort(
      (a, b) =>
        Number(a.change >= 0) - Number(b.change >= 0) || a.s.symbol.localeCompare(b.s.symbol),
    );
    for (const { s, target } of ready) {
      pending.delete(s.symbol);
      execute(s, date, target);
    }

    // 2. Dzisiejsze prognozy → zlecenia na kolejne zamknięcie. Nowsza
    //    prognoza zastępuje czekającą; „bez zmian” ją anuluje.
    for (const s of (bySignalDay.get(date) ?? []).sort((a, b) =>
      a.symbol.localeCompare(b.symbol),
    )) {
      if (targetWeight(s, rules) === null) pending.delete(s.symbol);
      else pending.set(s.symbol, s);
    }

    // 3. Wycena na koniec dnia.
    const total = navAt(date);
    nav.push({ date, navPln: total, cashPln: cash, investedPln: total - cash });
  }

  return {
    trades,
    nav,
    cashPln: cash,
    holdings: [...holdings.entries()]
      .map(([symbol, h]) => ({
        symbol,
        units: h.units,
        costPln: h.costPln,
        valuePln: valueOf(symbol, h.units, opts.end),
      }))
      .sort((a, b) => b.valuePln - a.valuePln),
  };
}
