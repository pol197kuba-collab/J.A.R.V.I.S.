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
// - Wielkość pozycji: „wzrost” → długa, „spadek” → krótka (na papierze),
//   „bez zmian” → nie otwieraj nic nowego (i anuluj czekające zlecenie).
//   Cel = 20% × pewność × dźwignia, gdzie dźwignia rośnie z pewnością: do
//   60% pewności 1×, przy 100% — maxLeverage (2×). Czyli najwyżej 40%
//   portfela w jednym instrumencie.
// - Dźwignia: łączna ekspozycja (suma |pozycji|) ≤ maxLeverage × kapitał.
//   Pożyczona gotówka (ujemne saldo) kosztuje financingRate rocznie, krótka
//   pozycja — opłatę za pożyczenie papierów (borrowRateByClass), naliczane
//   codziennie. Margin call: gdy kapitał spadnie poniżej maintenanceShare
//   wymaganego depozytu (ekspozycja / maxLeverage), wszystkie pozycje są
//   przymusowo zamykane po bieżącej cenie.
// - Horyzont: pozycja żyje tyle, ile horyzont prognozy, która ją otworzyła
//   albo potwierdziła (krypto — dni kalendarzowe, reszta — sesje). Bez nowej
//   prognozy w tym samym kierunku — zamknięcie po upływie horyzontu.
// - Stop-loss / take-profit zależne od zmienności: odległość = k × σ dzienna
//   (z 20 ostatnich sesji) × √(sesje horyzontu), od ceny wejścia albo
//   ostatniego potwierdzenia (działa jak trailing). Sprawdzane na każdym
//   notowaniu, jakie mamy — dziś na zamknięciach dziennych.
// - Drobne korekty (< 500 zł albo < 2% portfela) są pomijane — inaczej
//   codzienne wahania pewności (65% → 68%) dokupowałyby po tysiąc złotych
//   i mieliły prowizję. Pełne zamknięcie pozycji zawsze przechodzi.
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
  /** Horyzont tej prognozy w dniach; brak = rules.horizonDays. */
  horizonDays?: number;
  /**
   * Chwila postawienia prognozy (ISO). Z nią prognoza może się zrealizować
   * po pierwszej cenie z ciągu dnia PO tej chwili (zdarzenie „fill” z
   * przebiegu na żywo), a nie dopiero po kolejnym zamknięciu.
   */
  madeAt?: string;
};

/**
 * Zdarzenie z przebiegu na żywo (co 15 min, scripts/markets-live.ts),
 * zapisane w bazie z ceną i chwilą — dzięki temu przeliczenie całej
 * historii od zera daje zawsze ten sam wynik.
 * - fill: czekająca prognoza zrealizowana po cenie z ciągu dnia,
 * - stop / take: stop-loss / take-profit trafiony w trakcie sesji,
 * - alarm: model w alarmie zdecydował zamknąć pozycję.
 */
export type LiveEvent = {
  at: string;
  symbol: string;
  kind: "fill" | "stop" | "take" | "alarm";
  /** Cena środkowa w walucie instrumentu (spread dolicza silnik). */
  price: number;
  /** fill: dzień prognozy, którą realizuje (pending.madeOn). */
  signalOn?: string | null;
  /** stop/take/alarm: której strony pozycji dotyczy. */
  side?: "long" | "short" | null;
  reason?: string | null;
};

/** Czekające zlecenie na koniec symulacji — do realizacji na żywo. */
export type PendingOrder = {
  symbol: string;
  madeOn: string;
  madeAt: string | null;
  direction: Direction;
};

/** Otwarta pozycja z progami ryzyka na koniec symulacji. */
export type LivePosition = {
  symbol: string;
  side: "long" | "short";
  refPx: number;
  /** Progi jako ułamek ruchu od refPx (np. 0,04 = 4%); null = brak. */
  stop: number | null;
  take: number | null;
  expiresOn: string;
  signalOn: string;
  reason: string | null;
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
  /** Łączna ekspozycja ≤ maxLeverage × kapitał; 1 = bez dźwigni. */
  maxLeverage: number;
  /** Pewność (0–1), od której zaczyna rosnąć dźwignia pojedynczej pozycji. */
  leverageFromConfidence: number;
  /** Roczny koszt pożyczonej gotówki (ujemnego salda). */
  financingRate: number;
  /** Roczna opłata za pożyczenie papierów do krótkiej sprzedaży. */
  borrowRateByClass: Record<AssetClass, number>;
  /** Margin call, gdy kapitał < maintenanceShare × (ekspozycja / maxLeverage). */
  maintenanceShare: number;
  /** Stop-loss i take-profit w wielokrotnościach σ horyzontu; null = wyłączone. */
  stopSigma: number | null;
  takeSigma: number | null;
  /** Z ilu ostatnich zmian dziennych liczona jest σ. */
  volLookback: number;
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
    etf: 0.0006,
  },
  horizonDays: 7,
  allowShort: true,
  maxLeverage: 2,
  leverageFromConfidence: 0.6,
  financingRate: 0.07,
  borrowRateByClass: {
    crypto: 0.1,
    equity: 0.03,
    index: 0.02,
    commodity: 0.03,
    fx: 0.01,
    etf: 0.02,
  },
  maintenanceShare: 0.5,
  stopSigma: 1,
  takeSigma: 1.5,
  volLookback: 20,
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

export type SimResult = {
  trades: Trade[];
  nav: NavPoint[];
  holdings: Holding[];
  cashPln: number;
  /** Koszt dźwigni i pożyczonych papierów (≥ 0), już odjęty od gotówki. */
  financingPln: number;
  /** Ile razy zadziałał stop-loss / take-profit / margin call. */
  exits: {
    stopLoss: number;
    takeProfit: number;
    marginCall: number;
    horizon: number;
    alarm: number;
  };
  /** Stan na koniec: czekające zlecenia i pozycje z progami (dla przebiegu na żywo). */
  pending: PendingOrder[];
  live: LivePosition[];
};

// ---------- daty ----------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dzień tygodnia 0 = niedziela. */
const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Ile sesji mieści horyzont: krypto handluje codziennie, reszta w dni robocze. */
export function horizonSessions(days: number, assetClass: string): number {
  return assetClass === "crypto" ? Math.max(1, days) : Math.max(1, Math.round((days * 5) / 7));
}

/**
 * Dzień końca horyzontu prognozy z dnia `madeOn`. Krypto — dni kalendarzowe;
 * reszta — dni robocze, żeby prognoza dwudniowa z piątku nie „kończyła się”
 * w niedzielę na piątkowej cenie (zero ruchu = darmowe „bez zmian”).
 */
export function horizonEnd(madeOn: string, days: number, assetClass: string): string {
  if (assetClass === "crypto") return addDays(madeOn, days);
  let left = horizonSessions(days, assetClass);
  let d = madeOn;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = weekday(d);
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d;
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

  /** σ dziennych zmian logarytmicznych z `lookback` ostatnich sesji ≤ date; null przy < 5. */
  sigma(symbol: string, date: string, lookback: number): number | null {
    const s = this.series.get(symbol);
    if (!s) return null;
    let end = s.length - 1;
    while (end >= 0 && s[end].date > date) end -= 1;
    const from = Math.max(1, end - lookback + 1);
    const r: number[] = [];
    for (let i = from; i <= end; i++) r.push(Math.log(s[i].close / s[i - 1].close));
    if (r.length < 5) return null;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    const sd = Math.sqrt(v);
    return sd > 1e-9 ? sd : null;
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

/** Dźwignia pojedynczej pozycji: 1× do progu pewności, liniowo do maxLeverage przy 100%. */
export function leverageFor(confidence01: number, rules: FundRules = DEFAULT_RULES): number {
  if (rules.maxLeverage <= 1) return 1;
  const from = rules.leverageFromConfidence;
  const t = from >= 1 ? 0 : Math.min(1, Math.max(0, (confidence01 - from) / (1 - from)));
  return 1 + (rules.maxLeverage - 1) * t;
}

/** Docelowy udział w portfelu albo null = nie ruszaj pozycji. */
export function targetWeight(signal: FundSignal, rules: FundRules = DEFAULT_RULES): number | null {
  if (signal.weight !== undefined) return Math.min(rules.maxWeight, Math.max(0, signal.weight));
  if (signal.direction === "flat") return null;
  const c = Math.min(100, Math.max(0, signal.confidence)) / 100;
  const w = rules.maxWeight * c * leverageFor(c, rules);
  if (signal.direction === "down") return rules.allowShort ? -w : 0;
  return w;
}

// ---------- symulacja ----------

type Position = { units: number; costPln: number };

/** Powody transakcji wymuszonych regułami, a nie nową prognozą. */
export const HORIZON_EXIT_REASON =
  "Minął horyzont prognozy bez potwierdzenia — zamknięcie pozycji.";
export const STOP_LOSS_REASON = "Stop-loss (zależny od zmienności) — zamknięcie pozycji.";
export const TAKE_PROFIT_REASON = "Take-profit (zależny od zmienności) — realizacja zysku.";
export const MARGIN_CALL_REASON = "Margin call — kapitał poniżej wymaganego depozytu, zamknięcie.";
export const LIVE_STOP_REASON = "Stop-loss w trakcie sesji (zależny od zmienności).";
export const LIVE_TAKE_REASON = "Take-profit w trakcie sesji (zależny od zmienności).";

type Live = {
  signal: FundSignal;
  expiresOn: string;
  /** Cena odniesienia (wejście albo ostatnie potwierdzenie) i progi w ułamkach. */
  refPx: number;
  stop: number | null;
  take: number | null;
};

export function simulate(
  signals: FundSignal[],
  book: PriceBook,
  opts: { start: string; end: string; rules?: Partial<FundRules>; events?: LiveEvent[] },
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
  let financingPln = 0;
  const exits = { stopLoss: 0, takeProfit: 0, marginCall: 0, horizon: 0, alarm: 0 };
  const eventsByDay = new Map<string, LiveEvent[]>();
  for (const e of opts.events ?? []) {
    if (!book.instruments.has(e.symbol) || !(e.price > 0)) continue;
    const day = e.at.slice(0, 10);
    const list = eventsByDay.get(day) ?? [];
    list.push(e);
    eventsByDay.set(day, list);
  }
  /** Prognozy dnia zrealizowane już w trakcie tego dnia — nie trafią do kolejki. */
  const consumed = new Set<FundSignal>();
  const holdings = new Map<string, Position>();
  const pending = new Map<string, FundSignal>();
  const live = new Map<string, Live>();
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
  const grossAt = (date: string): number => {
    let g = 0;
    for (const [symbol, h] of holdings) g += Math.abs(valueOf(symbol, h.units, date));
    return g;
  };
  /** Ile jeszcze ekspozycji wolno otworzyć: maxLeverage × kapitał − obecna ekspozycja. */
  const buyingPowerAt = (date: string): number =>
    Math.max(1, rules.maxLeverage) * navAt(date) - grossAt(date);

  const execute = (
    signal: FundSignal,
    date: string,
    target: number,
    reason: string | null,
    /** Cena z ciągu dnia (zdarzenie na żywo); brak = zamknięcie dnia. */
    atPx?: number,
  ) => {
    const inst = book.instruments.get(signal.symbol)!;
    const px = atPx ?? prices.on(signal.symbol, date)!;
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
      const budget = Math.min(amountPln, buyingPowerAt(date) / (1 + rules.commissionRate));
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

  /** Ustawia horyzont i progi ryzyka pozycji po prognozie, która ją otworzyła/potwierdziła. */
  const arm = (s: FundSignal, date: string, atPx?: number): void => {
    const inst = book.instruments.get(s.symbol)!;
    const days = s.horizonDays ?? rules.horizonDays;
    if (days === null) {
      live.delete(s.symbol);
      return;
    }
    const px = atPx ?? prices.on(s.symbol, date)!;
    const sigma = prices.sigma(s.symbol, date, rules.volLookback);
    const scale = sigma === null ? null : sigma * Math.sqrt(horizonSessions(days, inst.assetClass));
    live.set(s.symbol, {
      signal: s,
      expiresOn: horizonEnd(s.madeOn, days, inst.assetClass),
      refPx: px,
      stop: scale !== null && rules.stopSigma !== null ? rules.stopSigma * scale : null,
      take: scale !== null && rules.takeSigma !== null ? rules.takeSigma * scale : null,
    });
  };

  /** Prognoza, na którą powołuje się transakcja wymuszona (signalOn < dziś). */
  const exitSignal = (symbol: string, date: string): FundSignal =>
    live.get(symbol)?.signal ?? {
      symbol,
      madeOn: addDays(date, -1),
      direction: "flat",
      confidence: 0,
      reason: null,
      predictionId: null,
    };

  for (let date = opts.start; date <= opts.end; date = addDays(date, 1)) {
    // 0. Zdarzenia z przebiegu na żywo, w kolejności czasu — przed
    //    zamknięciem dnia, bo zdarzyły się w jego trakcie.
    const todaySignals = bySignalDay.get(date) ?? [];
    for (const e of [...(eventsByDay.get(date) ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
      if (e.kind === "fill") {
        // Czekająca prognoza z wcześniejszego dnia albo dzisiejsza, postawiona
        // przed chwilą zdarzenia — tylko ta, na którą wskazuje zdarzenie.
        const waiting = pending.get(e.symbol);
        const s =
          waiting && waiting.madeOn === e.signalOn
            ? waiting
            : todaySignals.find(
                (x) =>
                  x.symbol === e.symbol &&
                  x.madeOn === e.signalOn &&
                  !consumed.has(x) &&
                  (x.madeAt === undefined || x.madeAt < e.at),
              );
        if (!s) continue;
        const target = targetWeight(s, rules);
        if (waiting === s) pending.delete(e.symbol);
        else consumed.add(s);
        if (target === null) continue;
        execute(s, date, target, s.reason, e.price);
        if (s.weight !== undefined || !holdings.has(e.symbol)) live.delete(e.symbol);
        else arm(s, date, e.price);
        continue;
      }
      const held = holdings.get(e.symbol);
      if (!held) continue;
      const side = held.units > 0 ? "long" : "short";
      if (e.side && e.side !== side) continue;
      const l = live.get(e.symbol);
      const reason =
        e.kind === "stop"
          ? LIVE_STOP_REASON
          : e.kind === "take"
            ? LIVE_TAKE_REASON
            : (e.reason ?? "Alarm AI — zamknięcie pozycji.");
      execute(l?.signal ?? exitSignal(e.symbol, date), date, 0, reason, e.price);
      live.delete(e.symbol);
      if (e.kind === "stop") exits.stopLoss += 1;
      else if (e.kind === "take") exits.takeProfit += 1;
      else exits.alarm += 1;
    }

    // 1. Realizacja czekających zleceń na dzisiejszym notowaniu — najpierw
    //    zmniejszenia ekspozycji (zwalniają depozyt), potem zwiększenia; w
    //    obrębie strony stała kolejność symboli. Pozycje po horyzoncie bez
    //    nowej prognozy zamykają się tutaj razem z resztą.
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
    const touched = new Set<string>();
    for (const r of ready) {
      const symbol = r.s.symbol;
      pending.delete(symbol);
      execute(r.s, date, r.target, r.reason);
      touched.add(symbol);
      if (r.exit) exits.horizon += 1;
      // Koszyk (waga wprost) i wyjście po horyzoncie nie uzbrajają niczego.
      if (r.exit || r.s.weight !== undefined || !holdings.has(symbol)) live.delete(symbol);
      else arm(r.s, date);
    }

    // 2. Stop-loss / take-profit na dzisiejszym notowaniu — dla pozycji,
    //    których dziś nie ruszała prognoza.
    for (const [symbol, l] of [...live]) {
      if (touched.has(symbol) || !holdings.has(symbol)) continue;
      const px = prices.on(symbol, date);
      if (px === null) continue;
      const long = holdings.get(symbol)!.units > 0;
      const move = (px / l.refPx - 1) * (long ? 1 : -1);
      const hitStop = l.stop !== null && move <= -l.stop;
      const hitTake = l.take !== null && move >= l.take;
      if (!hitStop && !hitTake) continue;
      execute(l.signal, date, 0, hitStop ? STOP_LOSS_REASON : TAKE_PROFIT_REASON);
      if (hitStop) exits.stopLoss += 1;
      else exits.takeProfit += 1;
      live.delete(symbol);
      touched.add(symbol);
    }

    // 3. Dzisiejsze prognozy → zlecenia na kolejne notowanie. Nowsza
    //    prognoza zastępuje czekającą; „bez zmian” ją anuluje.
    for (const s of [...todaySignals].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      if (consumed.has(s)) continue;
      if (targetWeight(s, rules) === null) pending.delete(s.symbol);
      else pending.set(s.symbol, s);
    }

    // 4. Koszt dźwigni i pożyczonych papierów za dzień.
    let cost = cash < 0 ? (-cash * rules.financingRate) / 365 : 0;
    for (const [symbol, h] of holdings) {
      if (h.units >= 0) continue;
      const cls = book.instruments.get(symbol)!.assetClass;
      cost += (-valueOf(symbol, h.units, date) * rules.borrowRateByClass[cls]) / 365;
    }
    cash -= cost;
    financingPln += cost;

    // 5. Margin call: kapitał poniżej depozytu podtrzymującego → zamknij
    //    wszystko, co ma dziś notowanie (reszta przy pierwszym notowaniu).
    const gross = grossAt(date);
    if (
      gross > 0 &&
      navAt(date) < (rules.maintenanceShare * gross) / Math.max(1, rules.maxLeverage)
    ) {
      for (const symbol of [...holdings.keys()].sort()) {
        if (prices.on(symbol, date) === null) continue;
        execute(exitSignal(symbol, date), date, 0, MARGIN_CALL_REASON);
        live.delete(symbol);
        pending.delete(symbol);
        exits.marginCall += 1;
      }
    }

    // 6. Wycena na koniec dnia.
    const total = navAt(date);
    nav.push({ date, navPln: total, cashPln: cash, investedPln: total - cash });
  }

  return {
    trades,
    nav,
    cashPln: cash,
    financingPln,
    exits,
    pending: [...pending.values()].map((p) => ({
      symbol: p.symbol,
      madeOn: p.madeOn,
      madeAt: p.madeAt ?? null,
      direction: p.direction,
    })),
    live: [...live.entries()].flatMap(([symbol, l]) => {
      const h = holdings.get(symbol);
      if (!h) return [];
      return [
        {
          symbol,
          side: h.units > 0 ? ("long" as const) : ("short" as const),
          refPx: l.refPx,
          stop: l.stop,
          take: l.take,
          expiresOn: l.expiresOn,
          signalOn: l.signal.madeOn,
          reason: l.signal.reason,
        },
      ];
    }),
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
