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
//   w obie strony. Bez dźwigni: „wolna gotówka” = gotówka − 2 × zobowiązanie
//   z krótkich pozycji (wpływ ze sprzedaży + 100% depozytu są zablokowane),
//   więc suma pozycji nigdy nie przekracza kapitału.
// - Wielkość pozycji: „wzrost” → długa, cel = 20% × pewność; „spadek” →
//   krótka (na papierze), cel = −20% × pewność (albo sprzedaż całości, gdy
//   krótka sprzedaż wyłączona); „bez zmian” → nie otwieraj nic nowego (i
//   anuluj czekające zlecenie).
// - Horyzont: prognoza mówi o 7 dniach, więc pozycja żyje 7 dni od prognozy,
//   która ją otworzyła albo potwierdziła. Bez nowej prognozy w tym samym
//   kierunku — zamknięcie na pierwszym zamknięciu po upływie horyzontu.
//   Wcześniej pozycja wisiała do prognozy „spadek”, a „bez zmian” trzymało ją
//   tygodniami — prognoza tygodniowa zamieniała się w inwestycję bezterminową.
// - Drobne korekty (< 500 zł albo < 2% portfela) są pomijane — inaczej
//   codzienne wahania pewności (65% → 68%) dokupowałyby po tysiąc złotych
//   i mieliły prowizję. Pełne zamknięcie pozycji zawsze przechodzi.
// - Krótka sprzedaż jest uproszczona: bez opłaty za pożyczenie papierów.
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
  /** Korekta mniejsza niż ten ułamek portfela jest pomijana (pasmo tolerancji). */
  minTradeNavShare: number;
  commissionRate: number;
  /** Pełny spread (kupno–sprzedaż) jako ułamek ceny, per klasa aktywów. */
  spreadByClass: Record<AssetClass, number>;
  /**
   * Ile dni żyje pozycja z prognozy bez potwierdzenia (horyzont prognozy).
   * null = bez wygasania (pozycja do prognozy przeciwnej).
   */
  horizonDays: number | null;
  /** „Spadek” otwiera krótką pozycję zamiast tylko zamykać długą. */
  allowShort: boolean;
};

export const DEFAULT_RULES: FundRules = {
  startCashPln: 100_000,
  maxWeight: 0.2,
  minTradePln: 500,
  minTradeNavShare: 0.02,
  // Typowa prowizja polskiego brokera na rynkach zagranicznych / krypto-giełdy.
  commissionRate: 0.001,
  spreadByClass: {
    crypto: 0.002,
    equity: 0.001,
    index: 0.001,
    commodity: 0.0008,
    fx: 0.0004,
  },
  horizonDays: 7,
  allowShort: true,
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

/**
 * Pozycja na koniec okresu. Krótka: units < 0, valuePln < 0 (zobowiązanie),
 * costPln < 0 (wpływ netto ze sprzedaży). Wynik w obu przypadkach = value − cost.
 */
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
  if (signal.direction === "flat") return null;
  const c = Math.min(100, Math.max(0, signal.confidence)) / 100;
  if (signal.direction === "down") return rules.allowShort ? -rules.maxWeight * c : 0;
  return rules.maxWeight * c;
}

// ---------- symulacja ----------

type Position = { units: number; costPln: number };

/** Powód transakcji zamykającej pozycję po upływie horyzontu prognozy. */
export const HORIZON_EXIT_REASON =
  "Minął horyzont prognozy bez potwierdzenia — zamknięcie pozycji.";

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
  const holdings = new Map<string, Position>();
  const pending = new Map<string, FundSignal>();
  /** Prognoza, która ostatnio otworzyła/potwierdziła pozycję, i dzień wygaśnięcia. */
  const live = new Map<string, { signal: FundSignal; expiresOn: string }>();
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
  /** Gotówka, za którą wolno otworzyć nową pozycję (bez dźwigni). */
  const freeCashAt = (date: string): number => {
    let shortLiability = 0;
    for (const [symbol, h] of holdings) {
      if (h.units < 0) shortLiability += -valueOf(symbol, h.units, date);
    }
    return cash - 2 * shortLiability;
  };

  const execute = (signal: FundSignal, date: string, target: number, reason: string | null) => {
    const inst = book.instruments.get(signal.symbol)!;
    const px = prices.on(signal.symbol, date)!;
    const fx = fxToPln(prices, inst.currency, date);
    if (fx === null) return;
    const half = rules.spreadByClass[inst.assetClass] / 2;
    const base = {
      symbol: signal.symbol,
      fxRate: fx,
      signalOn: signal.madeOn,
      executedOn: date,
      predictionId: signal.predictionId,
      reason,
      direction: signal.direction,
      confidence: signal.confidence,
    };
    const mid = px * fx;

    /** Zamyka `units` (> 0) z bieżącej pozycji — sprzedaż długiej albo odkup krótkiej. */
    const close = (units: number): void => {
      const held = holdings.get(signal.symbol)!;
      const long = held.units > 0;
      const price = long ? px * (1 - half) : px * (1 + half);
      const notional = units * price * fx;
      const fee = notional * rules.commissionRate;
      const cashFlow = long ? notional - fee : -(notional + fee);
      const costShare = held.costPln * (units / Math.abs(held.units));
      cash += cashFlow;
      const left = held.units + (long ? -units : units);
      if (Math.abs(left) <= Math.abs(held.units) * 1e-9) holdings.delete(signal.symbol);
      else holdings.set(signal.symbol, { units: left, costPln: held.costPln - costShare });
      trades.push({
        ...base,
        side: long ? "sell" : "buy",
        units,
        price,
        notionalPln: notional,
        feePln: fee,
        realizedPln: cashFlow - costShare,
      });
    };

    /** Otwiera/powiększa pozycję o `amountPln` (> 0) w stronę `long`. */
    const open = (amountPln: number, long: boolean): void => {
      const budget = Math.min(amountPln, freeCashAt(date) / (1 + rules.commissionRate));
      if (budget < rules.minTradePln) return;
      const held = holdings.get(signal.symbol) ?? { units: 0, costPln: 0 };
      const price = long ? px * (1 + half) : px * (1 - half);
      const units = budget / (price * fx);
      const fee = budget * rules.commissionRate;
      const cashFlow = long ? -(budget + fee) : budget - fee;
      cash += cashFlow;
      holdings.set(signal.symbol, {
        units: held.units + (long ? units : -units),
        costPln: held.costPln - cashFlow,
      });
      trades.push({
        ...base,
        side: long ? "buy" : "sell",
        units,
        price,
        notionalPln: budget,
        feePln: fee,
        realizedPln: null,
      });
    };

    const nav = navAt(date);
    const minTrade = Math.max(rules.minTradePln, rules.minTradeNavShare * nav);
    const held = holdings.get(signal.symbol);
    const current = held ? held.units * mid : 0;
    const desired = target * nav;

    // 1. Zamknięcie: cel po drugiej stronie zera (albo zero) = zamknij całość;
    //    cel po tej samej stronie, ale mniejszy = częściowa redukcja.
    if (held && current !== 0) {
      const flips = desired === 0 || Math.sign(desired) !== Math.sign(current);
      if (flips) {
        close(Math.abs(held.units));
      } else if (Math.abs(desired) < Math.abs(current)) {
        const reduce = Math.abs(current) - Math.abs(desired);
        if (reduce >= minTrade) close(reduce / mid);
        return;
      }
    }

    // 2. Otwarcie / dokupienie w stronę celu.
    if (desired === 0) return;
    const now = holdings.get(signal.symbol);
    const have = now ? Math.abs(now.units * mid) : 0;
    const add = Math.abs(desired) - have;
    if (add < minTrade) return;
    open(add, desired > 0);
  };

  for (let date = opts.start; date <= opts.end; date = addDays(date, 1)) {
    // 1. Realizacja czekających zleceń na dzisiejszym zamknięciu — najpierw
    //    zmniejszenia ekspozycji (zwalniają gotówkę), potem zwiększenia; w
    //    obrębie strony stała kolejność symboli, żeby wynik nie zależał od
    //    kolejności wejścia. Pozycje po horyzoncie bez nowej prognozy
    //    zamykają się tutaj razem z resztą.
    const today = navAt(date);
    type Ready = { s: FundSignal; target: number; reason: string | null; exit: boolean };
    const ready: Ready[] = [...pending.values()]
      .filter((s) => s.madeOn < date && prices.on(s.symbol, date) !== null)
      .map((s) => ({ s, target: targetWeight(s, rules)!, reason: s.reason, exit: false }));
    const readySymbols = new Set(ready.map((r) => r.s.symbol));
    for (const [symbol, l] of live) {
      if (l.expiresOn > date || pending.has(symbol) || readySymbols.has(symbol)) continue;
      if (!holdings.has(symbol) || prices.on(symbol, date) === null) continue;
      ready.push({ s: l.signal, target: 0, reason: HORIZON_EXIT_REASON, exit: true });
    }
    const exposureChange = (r: Ready): number => {
      const units = holdings.get(r.s.symbol)?.units ?? 0;
      return Math.abs(r.target * today) - Math.abs(valueOf(r.s.symbol, units, date));
    };
    ready.sort(
      (a, b) =>
        Number(exposureChange(a) >= 0) - Number(exposureChange(b) >= 0) ||
        a.s.symbol.localeCompare(b.s.symbol),
    );
    for (const r of ready) {
      const symbol = r.s.symbol;
      pending.delete(symbol);
      execute(r.s, date, r.target, r.reason);
      // Pozycja z prognozy żyje horyzont od tej prognozy; koszyk (waga
      // wprost) i wyjście po horyzoncie nie odnawiają niczego.
      if (r.exit || r.s.weight !== undefined || rules.horizonDays === null) {
        live.delete(symbol);
      } else if (holdings.has(symbol)) {
        live.set(symbol, { signal: r.s, expiresOn: addDays(r.s.madeOn, rules.horizonDays) });
      } else {
        live.delete(symbol);
      }
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
      .sort((a, b) => Math.abs(b.valuePln) - Math.abs(a.valuePln)),
  };
}
