// MARKET GRID — słownik instrumentów monitorowanych przez moduł /rynki.
//
// Ten plik jest jedynym źródłem prawdy o tym, CO obserwujemy i SKĄD to
// bierzemy. Trzymany w kodzie (nie w bazie) dokładnie z tego samego powodu co
// ORLEN_PRODUCTS w src/lib/fuel/orlen.ts: dołożenie instrumentu ma być
// jednolinijkową zmianą w repo, a nie migracją i wpisem do tabeli.
//
// `symbol` to nasz wewnętrzny, kanoniczny identyfikator — pod nim ląduje
// cache w public.market_quotes i pozycja na watchliście użytkownika. Nigdy
// nie jest to identyfikator zewnętrznego API; te siedzą w `source`, żeby
// zmiana dostawcy nie unieważniła zgromadzonych danych historycznych.

export type AssetClass = "crypto" | "equity" | "index" | "commodity" | "fx";

/**
 * Skąd pobrać notowania. Każdy wariant ma osobny adapter w ./providers.
 *
 * `stooq` niesie też `yahoo` jako zapasowy ticker: Stooq bywa niedostępny z
 * serwerowni (odpowiada stroną anty-bot zamiast CSV), a Yahoo bywa
 * rate-limitowany po IP. Żadne z tych dwóch darmowych źródeł nie jest
 * niezawodne samo w sobie, więc łańcuch próbuje po kolei i raportuje, które
 * faktycznie odpowiedziało.
 */
export type AssetSource =
  | { kind: "coingecko"; id: string }
  | { kind: "stooq"; ticker: string; yahoo?: string }
  | { kind: "fx"; base: string; quote: string };

export type MarketAsset = {
  symbol: string;
  label: string;
  assetClass: AssetClass;
  /** Waluta, w której podawana jest cena — do formatowania, nie do przeliczeń. */
  currency: string;
  /** Token z motywu HUD, używany przez wykresy i kafelki. */
  colorToken: string;
  source: AssetSource;
  /** Krótki opis „czym to jest", pokazywany w wyszukiwarce instrumentów. */
  hint?: string;
};

export const MARKET_ASSETS: MarketAsset[] = [
  // ---------------------------------------------------------------- krypto
  {
    symbol: "BTC",
    label: "Bitcoin",
    assetClass: "crypto",
    currency: "USD",
    colorToken: "var(--market-1)",
    source: { kind: "coingecko", id: "bitcoin" },
    hint: "Największa kryptowaluta, wyznacza kierunek całego rynku",
  },
  {
    symbol: "ETH",
    label: "Ethereum",
    assetClass: "crypto",
    currency: "USD",
    colorToken: "var(--market-2)",
    source: { kind: "coingecko", id: "ethereum" },
    hint: "Druga kapitalizacja, platforma smart kontraktów",
  },
  {
    symbol: "SOL",
    label: "Solana",
    assetClass: "crypto",
    currency: "USD",
    colorToken: "var(--market-3)",
    source: { kind: "coingecko", id: "solana" },
  },
  {
    symbol: "XRP",
    label: "XRP",
    assetClass: "crypto",
    currency: "USD",
    colorToken: "var(--market-4)",
    source: { kind: "coingecko", id: "ripple" },
  },
  // ---------------------------------------------------------------- akcje
  {
    symbol: "CDR.PL",
    label: "CD Projekt",
    assetClass: "equity",
    currency: "PLN",
    colorToken: "var(--market-5)",
    source: { kind: "stooq", ticker: "cdr.pl", yahoo: "CDR.WA" },
  },
  {
    symbol: "PKN.PL",
    label: "Orlen",
    assetClass: "equity",
    currency: "PLN",
    colorToken: "var(--market-6)",
    source: { kind: "stooq", ticker: "pkn.pl", yahoo: "PKN.WA" },
  },
  {
    symbol: "PKO.PL",
    label: "PKO BP",
    assetClass: "equity",
    currency: "PLN",
    colorToken: "var(--market-7)",
    source: { kind: "stooq", ticker: "pko.pl", yahoo: "PKO.WA" },
  },
  {
    symbol: "AAPL.US",
    label: "Apple",
    assetClass: "equity",
    currency: "USD",
    colorToken: "var(--market-8)",
    source: { kind: "stooq", ticker: "aapl.us", yahoo: "AAPL" },
  },
  {
    symbol: "NVDA.US",
    label: "NVIDIA",
    assetClass: "equity",
    currency: "USD",
    colorToken: "var(--market-1)",
    source: { kind: "stooq", ticker: "nvda.us", yahoo: "NVDA" },
  },
  {
    symbol: "MSFT.US",
    label: "Microsoft",
    assetClass: "equity",
    currency: "USD",
    colorToken: "var(--market-2)",
    source: { kind: "stooq", ticker: "msft.us", yahoo: "MSFT" },
  },
  // ---------------------------------------------------------------- indeksy
  {
    symbol: "WIG20",
    label: "WIG20",
    assetClass: "index",
    currency: "PLN",
    colorToken: "var(--market-3)",
    // Yahoo oddaje dla tego indeksu wyłącznie ostatnie notowanie (jeden punkt,
    // sprawdzone na żywo — WIG20.WA i WIG.WA zachowują się tak samo), więc
    // pełna historia przychodzi tylko ze Stooqa. Fallback zostaje, bo jedna
    // aktualna cena to nadal więcej niż pusty kafel, ale gdy wykres WIG20 jest
    // płaski, to znaczy dokładnie tyle, że Stooq nie odpowiedział.
    source: { kind: "stooq", ticker: "wig20", yahoo: "WIG20.WA" },
    hint: "20 największych spółek GPW · historia tylko ze Stooqa",
  },
  {
    symbol: "ETFBW20.PL",
    label: "ETF WIG20TR",
    assetClass: "index",
    currency: "PLN",
    colorToken: "var(--market-6)",
    // Nie jest to ten sam instrument co WIG20: to ETF na WIG20 Total Return
    // (uwzględnia dywidendy), notowany na GPW. Za to ma pełną historię w obu
    // źródłach — użyteczny zamiennik, gdy Stooq milczy.
    source: { kind: "stooq", ticker: "etfbw20tr.pl", yahoo: "ETFBW20TR.WA" },
    hint: "ETF na WIG20 z dywidendami — pełna historia także z Yahoo",
  },
  {
    symbol: "SPX",
    label: "S&P 500",
    assetClass: "index",
    currency: "USD",
    colorToken: "var(--market-4)",
    source: { kind: "stooq", ticker: "^spx", yahoo: "^GSPC" },
  },
  {
    symbol: "NDX",
    label: "Nasdaq 100",
    assetClass: "index",
    currency: "USD",
    colorToken: "var(--market-5)",
    source: { kind: "stooq", ticker: "^ndx", yahoo: "^NDX" },
  },
  // -------------------------------------------------------------- surowce
  {
    symbol: "XAUUSD",
    label: "Złoto",
    assetClass: "commodity",
    currency: "USD",
    colorToken: "var(--market-6)",
    source: { kind: "stooq", ticker: "xauusd", yahoo: "GC=F" },
    hint: 'Uncja trojańska, aktywo „bezpiecznej przystani"',
  },
  {
    symbol: "XAGUSD",
    label: "Srebro",
    assetClass: "commodity",
    currency: "USD",
    colorToken: "var(--market-7)",
    source: { kind: "stooq", ticker: "xagusd", yahoo: "SI=F" },
  },
  {
    symbol: "BRENT",
    label: "Ropa Brent",
    assetClass: "commodity",
    currency: "USD",
    colorToken: "var(--market-8)",
    source: { kind: "stooq", ticker: "cb.f", yahoo: "BZ=F" },
    hint: "To samo notowanie, które napędza moduł /paliwa",
  },
  {
    symbol: "NGAS",
    label: "Gaz ziemny",
    assetClass: "commodity",
    currency: "USD",
    colorToken: "var(--market-1)",
    source: { kind: "stooq", ticker: "ng.f", yahoo: "NG=F" },
  },
  // ------------------------------------------------------------------- FX
  {
    symbol: "USDPLN",
    label: "USD / PLN",
    assetClass: "fx",
    currency: "PLN",
    colorToken: "var(--market-2)",
    source: { kind: "fx", base: "USD", quote: "PLN" },
  },
  {
    symbol: "EURPLN",
    label: "EUR / PLN",
    assetClass: "fx",
    currency: "PLN",
    colorToken: "var(--market-3)",
    source: { kind: "fx", base: "EUR", quote: "PLN" },
  },
];

/** Watchlista nowego użytkownika — przekrój wszystkich klas aktywów. */
export const DEFAULT_WATCHLIST: readonly string[] = [
  "BTC",
  "ETH",
  "WIG20",
  "CDR.PL",
  "NVDA.US",
  "XAUUSD",
  "BRENT",
  "USDPLN",
];

export const ASSET_CLASS_LABELS: Readonly<Record<AssetClass, string>> = {
  crypto: "Krypto",
  equity: "Akcje",
  index: "Indeksy",
  commodity: "Surowce",
  fx: "Waluty",
};

const BY_SYMBOL = new Map(MARKET_ASSETS.map((a) => [a.symbol, a]));

export const assetBySymbol = (symbol: string): MarketAsset | undefined =>
  BY_SYMBOL.get(symbol.trim().toUpperCase());

export const isKnownSymbol = (symbol: string): boolean =>
  BY_SYMBOL.has(symbol.trim().toUpperCase());

/** Instrumenty pasujące do frazy — po symbolu i po nazwie, bez diakrytyków. */
export function searchAssets(query: string): MarketAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return MARKET_ASSETS;
  // NFD rozkłada „ó" na „o" + znak diakrytyczny, ale NIE rozkłada „ł"
  // (U+0142 to osobny znak, nie „l" z kreską) — bez tego podstawienia
  // wpisanie „zloto" nie znajdowało „Złoto".
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ł/g, "l")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  const needle = norm(q);
  return MARKET_ASSETS.filter(
    (a) => norm(a.symbol).includes(needle) || norm(a.label).includes(needle),
  );
}
