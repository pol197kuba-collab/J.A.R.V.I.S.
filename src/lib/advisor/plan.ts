// DORADCA — z prognoz graczy funduszu do konkretnego zagrania. Czysta logika.
//
// Wejście: głosy czterech graczy (AI, AI z wnioskami, AI 7 dni, Sygnały) na
// instrument, bieżąca cena, zamknięcia (σ), kurs waluty i ustawienia
// właściciela. Wyjście: karta zagrania — kierunek, siła, wejście, stop-loss,
// take-profit, wielkość pozycji z ryzyka, depozyt, dźwignia w limicie ESMA,
// loty XTB (gdy znamy wielkość kontraktu) i termin zamknięcia.
//
// ZASADY
// - Zgodność: każdy głos to +pewność (wzrost), −pewność (spadek) albo 0
//   („bez zmian”). Siła = |średnia| z głosów, które są, więc spór graczy ją
//   zjada (dwóch na wzrost i dwóch na spadek = 0). Kierunek = znak średniej.
//   Mniej niż MIN_VOTES głosów albo siła < MIN_STRENGTH = brak zagrania.
// - SL / TP jak w funduszu (engine.ts): k × σ dzienna × √(sesje horyzontu),
//   σ z ostatnich 20 zmian. Dolne ograniczenie MIN_STOP_PCT, żeby spokojny
//   instrument nie dostał stopu w szumie spreadu.
// - Wielkość z ryzyka: strata przy SL = kapitał × ryzyko% × mnożnik siły
//   (mocny 1, średni 0,6, słaby 0,3). Ekspozycja ograniczona do
//   maxExposure × kapitał i do tego, na co starcza depozytu przy dźwigni ESMA.
// - Dźwignia: limity ESMA dla klienta detalicznego (XTB je stosuje). Karta
//   podaje dźwignię konta i faktyczną ekspozycję (wartość pozycji / kapitał).

import { horizonEnd, horizonSessions, type Direction } from "@/lib/fund/engine";
import type { AssetClass } from "@/lib/markets/assets";
import type { PricePoint } from "@/lib/markets/series";

export const ADVISOR_PLAYERS = ["ai_learned", "ai", "ai_7d", "signals"] as const;
export type AdvisorPlayer = (typeof ADVISOR_PLAYERS)[number];

export const PLAYER_LABEL: Readonly<Record<AdvisorPlayer, string>> = {
  ai_learned: "AI z wnioskami",
  ai: "AI",
  ai_7d: "AI 7 dni",
  signals: "Sygnały",
};

export const MIN_VOTES = 2;
export const MIN_STRENGTH = 20;
export const STRONG_FROM = 70;
export const MEDIUM_FROM = 50;
export const MIN_STOP_PCT = 0.004;
/** Horyzont zagrania = horyzont główny prognoz (players.ts: MAIN_HORIZON). */
export const PLAY_HORIZON_DAYS = 2;

export type Vote = {
  player: AdvisorPlayer;
  direction: Direction;
  /** 0–100 */
  confidence: number;
  rationalePl: string | null;
  madeAt: string | null;
};

export type Grade = "strong" | "medium" | "weak";

export const GRADE_LABEL: Readonly<Record<Grade, string>> = {
  strong: "mocny",
  medium: "średni",
  weak: "słaby",
};

export function gradeOf(strength: number): Grade {
  return strength >= STRONG_FROM ? "strong" : strength >= MEDIUM_FROM ? "medium" : "weak";
}

export type Consensus = {
  direction: Direction;
  /** 0–100 */
  strength: number;
  /** Ilu graczy gra w kierunku zgodności / ilu w ogóle głosowało. */
  agree: number;
  total: number;
};

export function consensus(votes: Vote[]): Consensus {
  const total = votes.length;
  if (total === 0) return { direction: "flat", strength: 0, agree: 0, total: 0 };
  const signed = votes.map((v) => {
    const c = Math.min(100, Math.max(0, v.confidence));
    return v.direction === "up" ? c : v.direction === "down" ? -c : 0;
  });
  const mean = signed.reduce((a, b) => a + b, 0) / total;
  const direction: Direction = mean > 0 ? "up" : mean < 0 ? "down" : "flat";
  const agree = votes.filter((v) => v.direction === direction).length;
  return { direction, strength: Math.round(Math.abs(mean)), agree, total };
}

// ---------------------------------------------------------- ESMA / XTB ----

const MAJOR_INDICES = new Set(["SPX", "NDX"]);
const MAJOR_FX = new Set(["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"]);

/**
 * Maksymalna dźwignia klienta detalicznego (ESMA): waluty główne 30, inne
 * pary, złoto i główne indeksy 20, pozostałe indeksy i surowce 10, akcje i
 * ETF-y 5, krypto 2.
 */
export function esmaLeverage(symbol: string, assetClass: AssetClass): number {
  switch (assetClass) {
    case "crypto":
      return 2;
    case "equity":
    case "etf":
      return 5;
    case "index":
      // ETF na indeks notowany jak akcja (np. ETFBW20.PL) to CFD na akcję.
      if (symbol.endsWith(".PL") || symbol.endsWith(".US")) return 5;
      return MAJOR_INDICES.has(symbol) ? 20 : 10;
    case "commodity":
      return symbol === "XAUUSD" ? 20 : 10;
    case "fx":
      return MAJOR_FX.has(symbol) ? 30 : 20;
  }
}

/** Instrument w XTB: nazwa i (opcjonalnie) specyfikacja kontraktu z tabeli opłat. */
export type XtbSpec = {
  name: string;
  /** Ile jednostek instrumentu to 1 lot; brak = karta pokazuje jednostki zamiast lotów. */
  contractSize?: number;
  minLot?: number;
  lotStep?: number;
};

const XTB_NAMES: Record<string, string> = {
  BTC: "BITCOIN",
  ETH: "ETHEREUM",
  SOL: "SOLANA",
  XRP: "RIPPLE",
  DOGE: "DOGECOIN",
  ADA: "CARDANO",
  LTC: "LITECOIN",
  DOT: "POLKADOT",
  LINK: "CHAINLINK",
  BCH: "BITCOINCASH",
  XLM: "STELLAR",
  ETC: "ETHEREUMCLASSIC",
  WIG20: "W20",
  SPX: "US500",
  NDX: "US100",
  XAUUSD: "GOLD",
  XAGUSD: "SILVER",
  BRENT: "OIL",
  NGAS: "NATGAS",
};

/**
 * Nazwa w XTB: z ustawień właściciela, inaczej domyślna. Akcje i ETF-y w XTB
 * mają te same oznaczenia co u nas (AAPL.US, PKO.PL), reszta z tabeli wyżej.
 * Domyślne nazwy są najlepszym przybliżeniem — ustawienia pozwalają je poprawić.
 */
export function xtbSpecFor(symbol: string, overrides: Record<string, Partial<XtbSpec>>): XtbSpec {
  const o = overrides[symbol] ?? {};
  return {
    name: o.name?.trim() || XTB_NAMES[symbol] || symbol,
    contractSize: o.contractSize && o.contractSize > 0 ? o.contractSize : undefined,
    minLot: o.minLot && o.minLot > 0 ? o.minLot : undefined,
    lotStep: o.lotStep && o.lotStep > 0 ? o.lotStep : undefined,
  };
}

// ----------------------------------------------------------- ustawienia ----

export type AdvisorSettings = {
  capitalPln: number;
  /** Ile % kapitału ryzykujesz na jedno mocne zagranie (strata przy SL). */
  riskPct: number;
  /** Najwyższa wartość jednej pozycji jako wielokrotność kapitału. */
  maxExposure: number;
  /** Od jakiej siły wysyłać push. */
  pushMinStrength: number;
  /** Okno powiadomień w godzinach Warszawy [od, do). */
  pushFromHour: number;
  pushToHour: number;
  stopSigma: number;
  takeSigma: number;
  xtb: Record<string, Partial<XtbSpec>>;
};

export const DEFAULT_ADVISOR_SETTINGS: AdvisorSettings = {
  capitalPln: 10_000,
  riskPct: 2,
  maxExposure: 1,
  pushMinStrength: 70,
  pushFromHour: 7,
  pushToHour: 23,
  stopSigma: 1,
  takeSigma: 1.5,
  xtb: {},
};

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};

/** Ustawienia z bazy (dowolny JSON) → poprawne; braki = domyślne. */
export function parseAdvisorSettings(raw: unknown): AdvisorSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ADVISOR_SETTINGS;
  const xtbRaw = (o.xtb && typeof o.xtb === "object" ? o.xtb : {}) as Record<string, unknown>;
  const xtb: Record<string, Partial<XtbSpec>> = {};
  for (const [symbol, v] of Object.entries(xtbRaw)) {
    if (!v || typeof v !== "object" || !/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) continue;
    const s = v as Record<string, unknown>;
    const spec: Partial<XtbSpec> = {};
    if (typeof s.name === "string" && s.name.trim()) spec.name = s.name.trim().slice(0, 30);
    const cs = num(s.contractSize, 1e-9, 1e9, 0);
    if (cs > 0) spec.contractSize = cs;
    const ml = num(s.minLot, 1e-6, 1e6, 0);
    if (ml > 0) spec.minLot = ml;
    const ls = num(s.lotStep, 1e-6, 1e6, 0);
    if (ls > 0) spec.lotStep = ls;
    if (Object.keys(spec).length > 0) xtb[symbol] = spec;
  }
  const from = Math.round(num(o.pushFromHour, 0, 23, d.pushFromHour));
  const to = Math.round(num(o.pushToHour, 1, 24, d.pushToHour));
  return {
    capitalPln: num(o.capitalPln, 100, 1e9, d.capitalPln),
    riskPct: num(o.riskPct, 0.1, 20, d.riskPct),
    maxExposure: num(o.maxExposure, 0.1, 30, d.maxExposure),
    pushMinStrength: Math.round(num(o.pushMinStrength, 0, 100, d.pushMinStrength)),
    pushFromHour: from,
    pushToHour: to > from ? to : d.pushToHour,
    stopSigma: num(o.stopSigma, 0.3, 5, d.stopSigma),
    takeSigma: num(o.takeSigma, 0.3, 8, d.takeSigma),
    xtb,
  };
}

// ---------------------------------------------------------------- karta ----

export type NewsRef = {
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  impact: "positive" | "negative" | "neutral";
  summaryPl: string | null;
};

export type AdvisorInstrument = {
  symbol: string;
  label: string;
  assetClass: AssetClass;
  currency: string;
  /** Bieżąca cena (ostatnie notowanie, także z taktu na żywo). */
  price: number;
  priceAt: string | null;
  /** Kurs waluty instrumentu → PLN. */
  fxToPln: number;
  closes: PricePoint[];
  votes: Vote[];
  regime: string | null;
  technicalScore: number | null;
  sentimentScore: number | null;
  news: NewsRef[];
  /** Historia podobnych zagrań: ta sama klasa i kierunek, rozliczone. */
  history: { cases: number; hits: number } | null;
};

export type Play = {
  symbol: string;
  label: string;
  assetClass: AssetClass;
  currency: string;
  xtbName: string;
  side: "buy" | "sell";
  strength: number;
  grade: Grade;
  agree: number;
  total: number;
  entry: number;
  stop: number;
  take: number;
  /** Odległości jako ułamek ceny wejścia. */
  stopPct: number;
  takePct: number;
  /** Dźwignia konta (limit ESMA) i faktyczna ekspozycja (wartość / kapitał). */
  leverage: number;
  exposure: number;
  units: number;
  lots: number | null;
  /** Uwaga do wielkości (minimalny lot, limit ekspozycji…); null = brak. */
  sizeNote: string | null;
  nominalPln: number;
  marginPln: number;
  riskPln: number;
  rewardPln: number;
  expiresOn: string;
  priceAt: string | null;
  votes: Vote[];
  regime: string | null;
  technicalScore: number | null;
  sentimentScore: number | null;
  news: NewsRef[];
  history: { cases: number; hits: number } | null;
  /** Kluczowe liczby z wykresu. */
  trend20Pct: number | null;
  momentum5Pct: number | null;
  dailyVolPct: number | null;
};

/** σ dziennych zmian logarytmicznych z `lookback` ostatnich zamknięć; null przy < 5. */
export function dailySigma(closes: PricePoint[], lookback = 20): number | null {
  const s = [...closes].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const from = Math.max(1, s.length - lookback);
  const r: number[] = [];
  for (let i = from; i < s.length; i++) r.push(Math.log(s[i].close / s[i - 1].close));
  if (r.length < 5) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  const sd = Math.sqrt(v);
  return sd > 1e-9 ? sd : null;
}

const changeOver = (closes: PricePoint[], back: number): number | null => {
  const s = [...closes].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length <= back) return null;
  const a = s[s.length - 1 - back].close;
  const b = s[s.length - 1].close;
  return a > 0 ? (b / a - 1) * 100 : null;
};

const RISK_BY_GRADE: Readonly<Record<Grade, number>> = { strong: 1, medium: 0.6, weak: 0.3 };

const roundDown = (v: number, step: number): number => Math.floor(v / step + 1e-9) * step;

export function buildPlay(
  inst: AdvisorInstrument,
  settings: AdvisorSettings,
  today: string,
): Play | null {
  const c = consensus(inst.votes);
  if (c.total < MIN_VOTES || c.direction === "flat" || c.strength < MIN_STRENGTH) return null;
  if (!(inst.price > 0) || !(inst.fxToPln > 0)) return null;
  const sigma = dailySigma(inst.closes);
  if (sigma === null) return null;

  const long = c.direction === "up";
  const scale = sigma * Math.sqrt(horizonSessions(PLAY_HORIZON_DAYS, inst.assetClass));
  const stopPct = Math.max(MIN_STOP_PCT, settings.stopSigma * scale);
  const takePct = Math.max(MIN_STOP_PCT * 1.5, settings.takeSigma * scale);
  const entry = inst.price;
  const stop = long ? entry * (1 - stopPct) : entry * (1 + stopPct);
  const take = long ? entry * (1 + takePct) : entry * (1 - takePct);

  const grade = gradeOf(c.strength);
  const leverage = esmaLeverage(inst.symbol, inst.assetClass);
  const pxPln = entry * inst.fxToPln;
  const budgetRisk = settings.capitalPln * (settings.riskPct / 100) * RISK_BY_GRADE[grade];
  let nominal = budgetRisk / stopPct;
  let sizeNote: string | null = null;
  const capByExposure = settings.capitalPln * settings.maxExposure;
  const capByMargin = settings.capitalPln * leverage;
  if (nominal > capByExposure || nominal > capByMargin) {
    nominal = Math.min(capByExposure, capByMargin);
    sizeNote =
      capByExposure <= capByMargin
        ? `Ograniczone do ${fmtMult(settings.maxExposure)} kapitału (ustawienia) — ryzyko mniejsze niż ${settings.riskPct}%.`
        : `Ograniczone depozytem przy dźwigni 1:${leverage}.`;
  }
  let units = nominal / pxPln;

  const spec = xtbSpecFor(inst.symbol, settings.xtb);
  let lots: number | null = null;
  if (spec.contractSize) {
    const step = spec.lotStep ?? 0.01;
    const min = spec.minLot ?? step;
    lots = roundDown(units / spec.contractSize, step);
    if (lots < min) {
      lots = min;
      sizeNote = `Minimalna pozycja w XTB to ${min} lota — ryzyko wyższe niż zakładane.`;
    }
    lots = Math.round(lots / step) * step;
    units = lots * spec.contractSize;
    nominal = units * pxPln;
  }

  const riskPln = nominal * stopPct;
  const rewardPln = nominal * takePct;
  return {
    symbol: inst.symbol,
    label: inst.label,
    assetClass: inst.assetClass,
    currency: inst.currency,
    xtbName: spec.name,
    side: long ? "buy" : "sell",
    strength: c.strength,
    grade,
    agree: c.agree,
    total: c.total,
    entry,
    stop,
    take,
    stopPct,
    takePct,
    leverage,
    exposure: nominal / settings.capitalPln,
    units,
    lots,
    sizeNote,
    nominalPln: nominal,
    marginPln: nominal / leverage,
    riskPln,
    rewardPln,
    expiresOn: horizonEnd(today, PLAY_HORIZON_DAYS, inst.assetClass),
    priceAt: inst.priceAt,
    votes: inst.votes,
    regime: inst.regime,
    technicalScore: inst.technicalScore,
    sentimentScore: inst.sentimentScore,
    news: inst.news,
    history: inst.history,
    trend20Pct: changeOver(inst.closes, 20),
    momentum5Pct: changeOver(inst.closes, 5),
    dailyVolPct: sigma * 100,
  };
}

const fmtMult = (m: number): string => `${String(m).replace(".", ",")}×`;

export type MarketMood = { up: number; down: number; flat: number };

/** Ile instrumentów gracze widzą w górę / w dół / bez zmian (zgodność). */
export function marketMood(instruments: AdvisorInstrument[]): MarketMood {
  const mood = { up: 0, down: 0, flat: 0 };
  for (const i of instruments) {
    if (i.votes.length === 0) continue;
    const c = consensus(i.votes);
    if (c.direction === "flat" || c.strength < MIN_STRENGTH) mood.flat += 1;
    else mood[c.direction] += 1;
  }
  return mood;
}

/** Wszystkie zagrania, najmocniejsze pierwsze. */
export function buildPlays(
  instruments: AdvisorInstrument[],
  settings: AdvisorSettings,
  today: string,
): Play[] {
  return instruments
    .map((i) => buildPlay(i, settings, today))
    .filter((p): p is Play => p !== null)
    .sort((a, b) => b.strength - a.strength || a.symbol.localeCompare(b.symbol));
}

/** Zlecenie do schowka — jedna linia, gotowa do przepisania w XTB. */
export function orderText(p: Play, fmt: (v: number) => string): string {
  const size =
    p.lots !== null
      ? `${String(p.lots).replace(".", ",")} lota`
      : `${fmt(p.units)} szt. (≈${Math.round(p.nominalPln).toLocaleString("pl-PL")} zł)`;
  return [
    `XTB ${p.xtbName}: ${p.side === "buy" ? "KUP" : "SPRZEDAJ"} ${size}`,
    `SL ${fmt(p.stop)}`,
    `TP ${fmt(p.take)}`,
    `zamknij do ${p.expiresOn}`,
  ].join(" · ");
}
