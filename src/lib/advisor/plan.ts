// DORADCA — z prognoz graczy funduszu do konkretnego zagrania. Czysta logika.
//
// Wejście: głosy czterech graczy (AI, AI z wnioskami, AI 7 dni, Sygnały) na
// instrument, bieżąca cena, zamknięcia (σ) i kwota zagrania z ustawień.
// Wyjście: karta zagrania — kierunek, siła, wejście, stop-loss, take-profit,
// sugerowana dźwignia, ogólna podpowiedź „ile portfela”, termin zamknięcia
// i szacunek zysku / straty dla kwoty zagrania po kosztach brokera.
//
// ZASADY
// - Zgodność: każdy głos to +pewność (wzrost), −pewność (spadek) albo 0
//   („bez zmian”). Siła = |średnia| z głosów, które są, więc spór graczy ją
//   zjada (dwóch na wzrost i dwóch na spadek = 0). Kierunek = znak średniej.
//   Mniej niż MIN_VOTES głosów albo siła < MIN_STRENGTH = brak zagrania.
// - SL / TP jak w funduszu (engine.ts): k × σ dzienna × √(sesje horyzontu),
//   σ z ostatnich 20 zmian. Dolne ograniczenie MIN_STOP_PCT, żeby spokojny
//   instrument nie dostał stopu w szumie spreadu.
// - Dźwignia: mocny sygnał do 1:5, średni do 1:2, słaby bez dźwigni — nigdy
//   ponad limit ESMA, który stosuje XTB (krypto 1:2, akcje 1:5…).
// - Wyliczenia: kwota zagrania = Twoje pieniądze w pozycji (depozyt);
//   pozycja = kwota × dźwignia. Koszty: spread (kupno + sprzedaż) i opłata
//   za noc (swap) do terminu — szacunkowe stawki per klasa, nie do grosza.

import { addDays, horizonEnd, horizonSessions, type Direction } from "@/lib/fund/engine";
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

/** Sugerowana dźwignia: mocny do 1:5, średni do 1:2, słaby 1:1 — w limicie ESMA. */
export function suggestedLeverage(grade: Grade, cap: number): number {
  return Math.min(cap, grade === "strong" ? 5 : grade === "medium" ? 2 : 1);
}

/** Ile portfela na jedno zagranie — ogólna podpowiedź, bez kwot. */
export const PORTFOLIO_HINT: Readonly<Record<Grade, string>> = {
  strong: "nie więcej niż 5% portfela",
  medium: "nie więcej niż 2–3% portfela",
  weak: "najwyżej 1% portfela albo pomiń",
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

/** Nazwa instrumentu w XTB (akcje i ETF-y mają te same oznaczenia: AAPL.US, PKO.PL). */
export const xtbName = (symbol: string): string => XTB_NAMES[symbol] ?? symbol;

/**
 * Szacunkowe koszty CFD w XTB: spread za całe zagranie (kupno + sprzedaż)
 * i opłata za każdą noc trzymania (swap), jako ułamek wartości pozycji.
 * Przybliżenie z typowych tabel opłat — wystarczy do „ile mniej więcej”.
 */
export const BROKER_COSTS: Readonly<Record<AssetClass, { spread: number; swapPerNight: number }>> =
  {
    crypto: { spread: 0.0022, swapPerNight: 0.0006 },
    equity: { spread: 0.0015, swapPerNight: 0.0002 },
    etf: { spread: 0.0015, swapPerNight: 0.0002 },
    index: { spread: 0.0006, swapPerNight: 0.00015 },
    commodity: { spread: 0.0008, swapPerNight: 0.00015 },
    fx: { spread: 0.0003, swapPerNight: 0.00005 },
  };

/** Ile nocy trzymasz pozycję od dziś do dnia zamknięcia. */
export function nightsUntil(today: string, expiresOn: string): number {
  let n = 0;
  for (let d = today; d < expiresOn && n < 60; d = addDays(d, 1)) n += 1;
  return n;
}

// ----------------------------------------------------------- ustawienia ----

export type AdvisorSettings = {
  /** Kwota jednego zagrania (Twoje pieniądze) — do wyliczeń zysku i straty. */
  stakePln: number;
  /** Od jakiej siły wysyłać push. */
  pushMinStrength: number;
  /** Okno powiadomień w godzinach Warszawy [od, do). */
  pushFromHour: number;
  pushToHour: number;
  stopSigma: number;
  takeSigma: number;
};

export const DEFAULT_ADVISOR_SETTINGS: AdvisorSettings = {
  stakePln: 1000,
  pushMinStrength: 70,
  pushFromHour: 7,
  pushToHour: 23,
  stopSigma: 1,
  takeSigma: 1.5,
};

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};

/** Ustawienia z bazy (dowolny JSON) → poprawne; braki = domyślne. */
export function parseAdvisorSettings(raw: unknown): AdvisorSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ADVISOR_SETTINGS;
  const from = Math.round(num(o.pushFromHour, 0, 23, d.pushFromHour));
  const to = Math.round(num(o.pushToHour, 1, 24, d.pushToHour));
  return {
    stakePln: num(o.stakePln, 1, 1e9, d.stakePln),
    pushMinStrength: Math.round(num(o.pushMinStrength, 0, 100, d.pushMinStrength)),
    pushFromHour: from,
    pushToHour: to > from ? to : d.pushToHour,
    stopSigma: num(o.stopSigma, 0.3, 5, d.stopSigma),
    takeSigma: num(o.takeSigma, 0.3, 8, d.takeSigma),
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
  /** Sugerowana dźwignia i limit ESMA. */
  leverage: number;
  leverageCap: number;
  portfolioHint: string;
  /** Wyliczenia dla kwoty zagrania (zł): pozycja = kwota × dźwignia. */
  stakePln: number;
  positionPln: number;
  costPln: number;
  /** Zysk przy TP i strata przy SL, oba po kosztach (strata jako liczba dodatnia). */
  profitPln: number;
  lossPln: number;
  nights: number;
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

export function buildPlay(
  inst: AdvisorInstrument,
  settings: AdvisorSettings,
  today: string,
): Play | null {
  const c = consensus(inst.votes);
  if (c.total < MIN_VOTES || c.direction === "flat" || c.strength < MIN_STRENGTH) return null;
  if (!(inst.price > 0)) return null;
  const sigma = dailySigma(inst.closes);
  if (sigma === null) return null;

  const long = c.direction === "up";
  const scale = sigma * Math.sqrt(horizonSessions(PLAY_HORIZON_DAYS, inst.assetClass));
  const stopPct = Math.max(MIN_STOP_PCT, settings.stopSigma * scale);
  const takePct = Math.max(MIN_STOP_PCT * 1.5, settings.takeSigma * scale);
  const entry = inst.price;

  const grade = gradeOf(c.strength);
  const leverageCap = esmaLeverage(inst.symbol, inst.assetClass);
  const leverage = suggestedLeverage(grade, leverageCap);
  const expiresOn = horizonEnd(today, PLAY_HORIZON_DAYS, inst.assetClass);
  const nights = nightsUntil(today, expiresOn);
  const position = settings.stakePln * leverage;
  const fee = BROKER_COSTS[inst.assetClass];
  const cost = position * (fee.spread + fee.swapPerNight * nights);

  return {
    symbol: inst.symbol,
    label: inst.label,
    assetClass: inst.assetClass,
    currency: inst.currency,
    xtbName: xtbName(inst.symbol),
    side: long ? "buy" : "sell",
    strength: c.strength,
    grade,
    agree: c.agree,
    total: c.total,
    entry,
    stop: long ? entry * (1 - stopPct) : entry * (1 + stopPct),
    take: long ? entry * (1 + takePct) : entry * (1 - takePct),
    stopPct,
    takePct,
    leverage,
    leverageCap,
    portfolioHint: PORTFOLIO_HINT[grade],
    stakePln: settings.stakePln,
    positionPln: position,
    costPln: cost,
    profitPln: position * takePct - cost,
    lossPln: position * stopPct + cost,
    nights,
    expiresOn,
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
  return [
    `XTB ${p.xtbName}: ${p.side === "buy" ? "KUP" : "SPRZEDAJ"}`,
    `dźwignia 1:${p.leverage}`,
    `SL ${fmt(p.stop)}`,
    `TP ${fmt(p.take)}`,
    `zamknij do ${p.expiresOn}`,
  ].join(" · ");
}
