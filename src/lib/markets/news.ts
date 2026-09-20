// MARKET GRID — strumień newsów i ocena ich wpływu na obserwowane
// instrumenty. Etap 2 modułu /rynki.
//
// Parsowanie RSS-a jest wspólne z modułem paliwowym (src/lib/rss/parse.ts);
// tutaj zostaje to, co specyficzne dla rynków: dobór kanałów, przypisanie
// nagłówka do instrumentu i słownikowa ocena kierunku.
//
// RÓŻNICA WOBEC MODUŁU PALIW, która przewija się przez cały plik: tam
// „bullish" znaczyło jedno (droższe paliwo), bo instrument był jeden. Tutaj
// ten sam nagłówek bywa bullish dla złota i bearish dla akcji, więc kierunek
// jest zawsze WZGLĘDEM KONKRETNEGO INSTRUMENTU, nigdy globalny.
import { MARKET_ASSETS, type MarketAsset } from "./assets";
import type { FeedSource } from "@/lib/rss/parse";

// ŹRÓDŁA WYDAWCÓW, NIE GOOGLE NEWS — i to jest istota tej listy.
//
// Pierwsza wersja odpytywała Google News (news.google.com/rss/search).
// Na produkcji WSZYSTKIE sześć kanałów zwracało HTTP 503 przy każdym
// zaciągu: Google odrzuca ruch z adresów IP centrów danych, a aplikacja
// stoi właśnie na takim. Z laptopa te same adresy działają, więc usterka
// była niewidoczna aż do pierwszego uruchomienia na żywo.
//
// Każdy kanał poniżej został sprawdzony realnym żądaniem z serwerowni i
// zwrócił pozycje. Dobór pilnuje pokrycia klas aktywów z katalogu: makro i
// akcje, krypto (dwa źródła, bo to najbardziej ruchliwa klasa), surowce i
// energia, oraz polski rynek — GPW i waluty, których anglojęzyczne serwisy
// nie opisują.
export const MARKET_FEEDS: readonly FeedSource[] = [
  { tag: "macro", label: "Makro", url: "https://www.investing.com/rss/news_1.rss" },
  { tag: "equities", label: "Spółki", url: "https://www.investing.com/rss/news_285.rss" },
  { tag: "crypto", label: "Krypto", url: "https://www.investing.com/rss/news_301.rss" },
  { tag: "crypto-alt", label: "Krypto (Cointelegraph)", url: "https://cointelegraph.com/rss" },
  {
    tag: "commodities",
    label: "Surowce",
    url: "https://www.investing.com/rss/commodities.rss",
  },
  // Ten sam kanał, z którego korzysta moduł paliwowy — ropa i gaz.
  { tag: "energy", label: "Energia", url: "https://oilprice.com/rss/main" },
  { tag: "gpw", label: "GPW", url: "https://www.bankier.pl/rss/gielda.xml" },
  { tag: "pl-fx", label: "Waluty", url: "https://www.bankier.pl/rss/waluty.xml" },
] as const;

export type MarketImpact = "bullish" | "bearish" | "neutral";

export type MarketNewsItem = {
  guid: string;
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  feedTag: string;
  /** Symbole z katalogu, których news dotyczy. Pusta tablica = news ogólnorynkowy. */
  symbols: string[];
  impact: MarketImpact;
  /** 0-100 — jak mocno news może ruszyć ceną wskazanych instrumentów. */
  impactScore: number;
  summaryPl: string | null;
  classifiedBy: "ai" | "heuristic";
};

export type MarketVerdict = {
  symbols: string[];
  impact: MarketImpact;
  impactScore: number;
  summaryPl: string | null;
  classifiedBy: "ai" | "heuristic";
};

// --------------------------------------------- przypisanie do instrumentu ----

/**
 * Hasła, po których nagłówek trafia do instrumentu.
 *
 * Dopasowanie idzie po GRANICY SŁOWA, nie po fragmencie — „gold" nie może
 * łapać „Golden Cross" (realny fałszywy trafik z pierwszego przebiegu:
 * „Bitcoin Golden Cross" wylądował przy złocie). Gwiazdka na końcu znaczy
 * „przedrostek": polska odmiana wymaga „złot*" (złoto, złota, złotego),
 * ale angielskie „gold" musi być całym słowem.
 *
 * Celowo bez gołych, krótkich tickerów („BTC" wpada w „debt", „SOL" w
 * „solar") — tylko nazwy własne i jednoznaczne skróty.
 */
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana"],
  XRP: ["xrp", "ripple"],
  "CDR.PL": ["cd projekt", "cdprojekt", "cyberpunk", "wiedźmin", "witcher"],
  "PKN.PL": ["orlen"],
  "PKO.PL": ["pko bp", "pko bank"],
  "AAPL.US": ["apple", "iphone"],
  "NVDA.US": ["nvidia"],
  "MSFT.US": ["microsoft"],
  WIG20: ["wig20", "wig 20", "gpw", "warsaw stock exchange"],
  "ETFBW20.PL": ["wig20tr", "etfbw20"],
  SPX: ["s&p 500", "s&p500", "sp500"],
  NDX: ["nasdaq"],
  XAUUSD: ["gold", "złot*", "zlot*", "bullion"],
  XAGUSD: ["silver", "srebr*"],
  BRENT: ["brent", "crude oil", "ropa naftowa", "opec"],
  NGAS: ["natural gas", "gaz ziemny", "henry hub"],
  USDPLN: ["usd/pln", "kurs dolara", "dolar*"],
  EURPLN: ["eur/pln", "kurs euro", "euro"],
};

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Buduje matcher dla jednego hasła. Bez gwiazdki — całe słowo; z gwiazdką —
 * przedrostek (słowo musi się od niego zaczynać).
 *
 * `\b` nie działa poprawnie dla polskich liter w niektórych silnikach, więc
 * granicę po lewej stronie wyrażamy jawnie: początek napisu albo znak
 * niebędący literą/cyfrą.
 */
function keywordMatcher(keyword: string): RegExp {
  const isPrefix = keyword.endsWith("*");
  const core = escapeRe(isPrefix ? keyword.slice(0, -1) : keyword);
  const right = isPrefix ? "" : "(?![\\p{L}\\p{N}])";
  return new RegExp(`(?<![\\p{L}\\p{N}])${core}${right}`, "iu");
}

// Wyrażenia są niezmienne, więc kompilujemy je raz — matchSymbols leci po
// każdym nagłówku razy każdy instrument.
const MATCHERS: Readonly<Record<string, readonly RegExp[]>> = Object.fromEntries(
  Object.entries(KEYWORDS).map(([symbol, words]) => [symbol, words.map(keywordMatcher)]),
);

export function matchSymbols(title: string, assets: readonly MarketAsset[]): string[] {
  const matched: string[] = [];
  for (const asset of assets) {
    const matchers = MATCHERS[asset.symbol] ?? [keywordMatcher(asset.label)];
    if (matchers.some((re) => re.test(title))) matched.push(asset.symbol);
  }
  return matched;
}

// ------------------------------------------------ słownikowa ocena wpływu ----

// Kierunek jest liczony dla instrumentu, którego news dotyczy: „rekordowe
// wyniki" to wzrost dla spółki, „recesja" to spadek dla akcji.
const BULLISH = [
  "beats",
  "beat expectations",
  "record high",
  "all-time high",
  "surge",
  "surges",
  "rally",
  "rallies",
  "jumps",
  "soars",
  "upgrade",
  "raises guidance",
  "buyback",
  "approval",
  "inflow",
  "adoption",
  "rate cut",
  "stimulus",
  "rekord",
  "zyski",
  "wzrost",
  "wzrosty",
  "podwyżka prognoz",
  "obniżka stóp",
];
const BEARISH = [
  "misses",
  "miss expectations",
  "plunge",
  "plunges",
  "slump",
  "slumps",
  "tumbles",
  "sinks",
  "downgrade",
  "cuts guidance",
  "lawsuit",
  "probe",
  "investigation",
  "recall",
  "outflow",
  "selloff",
  "sell-off",
  "crash",
  "recession",
  "layoffs",
  "rate hike",
  "default",
  "spadek",
  "spadki",
  "straty",
  "przecena",
  "recesja",
  "zwolnienia",
  "podwyżka stóp",
];
// Nagłówki, które historycznie ruszają rynkiem mocniej niż przeciętne.
const HIGH_IMPACT = [
  "fed",
  "fomc",
  "ecb",
  "cpi",
  "inflation",
  "tariff",
  "war",
  "sanction",
  "default",
  "etf approval",
  "halving",
  "nbp",
  "inflacja",
];

/**
 * Zapasowa ocena wpływu, gdy nie ma klucza AI albo model zawiódł.
 *
 * Celowo konserwatywna: przy braku sygnału mówi „neutral" zamiast zgadywać
 * kierunek. Fałszywy „bullish" na panelu inwestycyjnym jest kosztowniejszy
 * niż uczciwe „nie wiem".
 */
export function heuristicImpact(title: string): Omit<MarketVerdict, "symbols"> {
  const text = title.toLowerCase();
  const bull = BULLISH.filter((w) => text.includes(w)).length;
  const bear = BEARISH.filter((w) => text.includes(w)).length;
  const weighty = HIGH_IMPACT.some((w) => text.includes(w));

  let impact: MarketImpact = "neutral";
  if (bull > bear) impact = "bullish";
  else if (bear > bull) impact = "bearish";

  const strength = Math.abs(bull - bear);
  const impactScore =
    impact === "neutral"
      ? weighty
        ? 35
        : 20
      : Math.min(90, 40 + strength * 15 + (weighty ? 15 : 0));

  return { impact, impactScore, summaryPl: null, classifiedBy: "heuristic" };
}

/** Pełny werdykt zapasowy: słownikowy kierunek + słownikowe dopasowanie. */
export const heuristicVerdict = (
  title: string,
  assets: readonly MarketAsset[] = MARKET_ASSETS,
): MarketVerdict => ({
  ...heuristicImpact(title),
  symbols: matchSymbols(title, assets),
});

// ------------------------------------------------------------- agregacja ----

export type SymbolSentiment = {
  symbol: string;
  /** Od -100 (jednoznacznie negatywny wydźwięk) do +100. */
  score: number;
  bullish: number;
  bearish: number;
  neutral: number;
  items: number;
};

/**
 * Wypadkowy wydźwięk newsów dla instrumentu — ważony siłą wpływu, bo pięć
 * ciekawostek nie równoważy jednej decyzji Fed.
 *
 * Nie jest to prognoza ceny i nie udaje nią być: to podsumowanie tego, co
 * napisano, a nie tego, co się stanie. Sygnały predykcyjne to etap 3.
 */
export function aggregateSentiment(items: MarketNewsItem[]): SymbolSentiment[] {
  const acc = new Map<
    string,
    { weighted: number; weight: number } & Omit<SymbolSentiment, "symbol" | "score">
  >();

  for (const item of items) {
    for (const symbol of item.symbols) {
      const row = acc.get(symbol) ?? {
        weighted: 0,
        weight: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        items: 0,
      };
      const direction = item.impact === "bullish" ? 1 : item.impact === "bearish" ? -1 : 0;
      row.weighted += direction * item.impactScore;
      row.weight += item.impactScore;
      row.items += 1;
      if (item.impact === "bullish") row.bullish += 1;
      else if (item.impact === "bearish") row.bearish += 1;
      else row.neutral += 1;
      acc.set(symbol, row);
    }
  }

  return [...acc.entries()]
    .map(([symbol, row]) => ({
      symbol,
      // Waga zerowa znaczy, że wszystkie newsy miały wpływ 0 — wtedy 0, a
      // nie dzielenie przez zero.
      score: row.weight > 0 ? Math.round((row.weighted / row.weight) * 100) : 0,
      bullish: row.bullish,
      bearish: row.bearish,
      neutral: row.neutral,
      items: row.items,
    }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}
