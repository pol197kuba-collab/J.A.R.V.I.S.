// MARKET GRID — zbiór skanera: płynne krypto i ETF-y.
//
// Skaner liczy sygnały dla wszystkich tych instrumentów co wieczór (sama
// arytmetyka, 0 tokenów), a model dostaje tylko najmocniejsze sytuacje
// (ingest.server MODEL_INSTRUMENTS). Lista statyczna, w kodzie — jak reszta
// słownika (assets.ts): „top 50” zmienia się powoli, a stała lista daje
// ciągłe serie i powtarzalne wyniki. Bez stablecoinów i tokenów „opakowanych”
// (nie mają własnego ruchu ceny). Przegląd raz na kwartał.
//
// ŹRÓDŁA. Krypto: CoinGecko (id), Yahoo jako zapas (część monet ma w Yahoo
// przyrostek z numerem CoinMarketCap, np. SUI20947-USD — bez niego ticker
// wskazałby inny instrument albo nic). ETF-y: Stooq „xxx.us”, Yahoo
// „XXX”. Sprawdzenie, czy każde źródło odpowiada: workflow Market Grid z
// `--dry-run` (scripts/markets-daily.ts).

import type { MarketAsset } from "./assets";

const SLOTS = 8;
const slot = (i: number) => `var(--market-${(i % SLOTS) + 1})`;

/** [symbol, nazwa, id CoinGecko, ticker Yahoo] */
const CRYPTO: Array<[string, string, string, string]> = [
  ["BNB", "BNB", "binancecoin", "BNB-USD"],
  ["DOGE", "Dogecoin", "dogecoin", "DOGE-USD"],
  ["ADA", "Cardano", "cardano", "ADA-USD"],
  ["TRX", "TRON", "tron", "TRX-USD"],
  ["AVAX", "Avalanche", "avalanche-2", "AVAX-USD"],
  ["LINK", "Chainlink", "chainlink", "LINK-USD"],
  ["DOT", "Polkadot", "polkadot", "DOT-USD"],
  ["TON", "Toncoin", "the-open-network", "TON11419-USD"],
  ["SHIB", "Shiba Inu", "shiba-inu", "SHIB-USD"],
  ["LTC", "Litecoin", "litecoin", "LTC-USD"],
  ["BCH", "Bitcoin Cash", "bitcoin-cash", "BCH-USD"],
  ["NEAR", "NEAR Protocol", "near", "NEAR-USD"],
  ["UNI", "Uniswap", "uniswap", "UNI7083-USD"],
  ["APT", "Aptos", "aptos", "APT21794-USD"],
  ["ICP", "Internet Computer", "internet-computer", "ICP-USD"],
  ["XLM", "Stellar", "stellar", "XLM-USD"],
  ["ETC", "Ethereum Classic", "ethereum-classic", "ETC-USD"],
  ["XMR", "Monero", "monero", "XMR-USD"],
  ["ATOM", "Cosmos", "cosmos", "ATOM-USD"],
  ["FIL", "Filecoin", "filecoin", "FIL-USD"],
  ["HBAR", "Hedera", "hedera-hashgraph", "HBAR-USD"],
  ["ARB", "Arbitrum", "arbitrum", "ARB11841-USD"],
  ["ZEC", "Zcash", "zcash", "ZEC-USD"],
  ["INJ", "Injective", "injective-protocol", "INJ-USD"],
  ["QNT", "Quant", "quant-network", "QNT-USD"],
  ["SUI", "Sui", "sui", "SUI20947-USD"],
  ["AAVE", "Aave", "aave", "AAVE-USD"],
  ["ALGO", "Algorand", "algorand", "ALGO-USD"],
  ["VET", "VeChain", "vechain", "VET-USD"],
  ["PEPE", "Pepe", "pepe", "PEPE24478-USD"],
  ["TAO", "Bittensor", "bittensor", "TAO22974-USD"],
  ["KAS", "Kaspa", "kaspa", "KAS-USD"],
  ["XTZ", "Tezos", "tezos", "XTZ-USD"],
  ["SAND", "The Sandbox", "the-sandbox", "SAND-USD"],
  ["MANA", "Decentraland", "decentraland", "MANA-USD"],
  ["GRT", "The Graph", "the-graph", "GRT6719-USD"],
  ["IMX", "Immutable", "immutable-x", "IMX10603-USD"],
  ["STX", "Stacks", "blockstack", "STX4847-USD"],
  ["MNT", "Mantle", "mantle", "MNT27075-USD"],
  ["THETA", "Theta Network", "theta-token", "THETA-USD"],
  ["SEI", "Sei", "sei-network", "SEI-USD"],
  ["WLD", "Worldcoin", "worldcoin-wld", "WLD-USD"],
  ["ONDO", "Ondo", "ondo-finance", "ONDO-USD"],
  ["HYPE", "Hyperliquid", "hyperliquid", "HYPE32196-USD"],
  ["ENA", "Ethena", "ethena", "ENA-USD"],
  ["CRV", "Curve DAO", "curve-dao-token", "CRV-USD"],
  ["LDO", "Lido DAO", "lido-dao", "LDO-USD"],
  ["JUP", "Jupiter", "jupiter-exchange-solana", "JUP29210-USD"],
  ["BONK", "Bonk", "bonk", "BONK-USD"],
  ["FET", "Artificial Superintelligence (FET)", "fetch-ai", "FET-USD"],
];

/** [ticker USA, nazwa, opis] — notowane w USD. */
const ETF: Array<[string, string, string]> = [
  // szeroki rynek
  ["SPY", "S&P 500 (SPY)", "500 największych spółek USA"],
  ["QQQ", "Nasdaq 100 (QQQ)", "technologia i wzrost USA"],
  ["IWM", "Russell 2000 (IWM)", "małe spółki USA"],
  ["DIA", "Dow Jones (DIA)", "30 blue chipów USA"],
  ["VTI", "Cały rynek USA (VTI)", "wszystkie spółki USA"],
  ["VEA", "Rynki rozwinięte ex-USA (VEA)", "Europa, Japonia, Australia"],
  ["VWO", "Rynki wschodzące (VWO)", "Chiny, Indie, Brazylia i in."],
  ["EFA", "MSCI EAFE (EFA)", "rozwinięte poza Ameryką"],
  ["EEM", "MSCI Emerging (EEM)", "rynki wschodzące"],
  ["ACWI", "Cały świat (ACWI)", "akcje świata"],
  // sektory USA
  ["XLK", "Sektor: technologia (XLK)", "S&P 500 tech"],
  ["XLF", "Sektor: finanse (XLF)", "banki, ubezpieczyciele"],
  ["XLE", "Sektor: energia (XLE)", "ropa i gaz"],
  ["XLV", "Sektor: zdrowie (XLV)", "farmacja, ochrona zdrowia"],
  ["XLI", "Sektor: przemysł (XLI)", "przemysł, transport"],
  ["XLY", "Sektor: dobra uznaniowe (XLY)", "handel, motoryzacja"],
  ["XLP", "Sektor: dobra podstawowe (XLP)", "żywność, chemia domowa"],
  ["XLU", "Sektor: użyteczność publiczna (XLU)", "energetyka, wodociągi"],
  ["XLB", "Sektor: materiały (XLB)", "chemia, surowce"],
  ["XLRE", "Sektor: nieruchomości (XLRE)", "REIT-y"],
  ["XLC", "Sektor: komunikacja (XLC)", "media, telekomy"],
  ["SMH", "Półprzewodniki (SMH)", "producenci chipów"],
  ["XBI", "Biotechnologia (XBI)", "biotech USA"],
  ["KRE", "Banki regionalne (KRE)", "regionalne banki USA"],
  ["ITB", "Budownictwo mieszkaniowe (ITB)", "deweloperzy USA"],
  // tematy
  ["ARKK", "ARK Innovation (ARKK)", "spółki „disruptive”"],
  ["TAN", "Energia słoneczna (TAN)", "fotowoltaika"],
  ["ICLN", "Czysta energia (ICLN)", "OZE na świecie"],
  ["LIT", "Lit i baterie (LIT)", "łańcuch baterii"],
  ["URA", "Uran (URA)", "wydobycie uranu"],
  ["JETS", "Linie lotnicze (JETS)", "lotnictwo"],
  ["KWEB", "Chiński internet (KWEB)", "Alibaba, Tencent i in."],
  ["IBIT", "Bitcoin ETF (IBIT)", "spot bitcoin w ETF"],
  // obligacje
  ["TLT", "Obligacje USA 20+ lat (TLT)", "długi koniec krzywej"],
  ["IEF", "Obligacje USA 7–10 lat (IEF)", "środek krzywej"],
  ["SHY", "Obligacje USA 1–3 lata (SHY)", "krótki koniec"],
  ["LQD", "Obligacje korporacyjne IG (LQD)", "inwestycyjne"],
  ["HYG", "Obligacje wysokodochodowe (HYG)", "„śmieciowe”"],
  ["TIP", "Obligacje indeksowane inflacją (TIP)", "TIPS"],
  ["AGG", "Obligacje USA — całość (AGG)", "agregat rynku długu"],
  ["EMB", "Obligacje rynków wschodzących (EMB)", "dług EM w USD"],
  // surowce
  ["GLD", "Złoto (GLD)", "fizyczne złoto"],
  ["SLV", "Srebro (SLV)", "fizyczne srebro"],
  ["USO", "Ropa WTI (USO)", "kontrakty na ropę"],
  ["UNG", "Gaz ziemny USA (UNG)", "kontrakty na gaz"],
  ["DBA", "Rolnictwo (DBA)", "zboża, cukier, kawa"],
  ["DBC", "Surowce — koszyk (DBC)", "szeroki koszyk surowców"],
  ["CPER", "Miedź (CPER)", "kontrakty na miedź"],
  ["GDX", "Kopalnie złota (GDX)", "duże kopalnie"],
  ["GDXJ", "Kopalnie złota — małe (GDXJ)", "juniorzy"],
  // kraje
  ["EPOL", "Polska (EPOL)", "MSCI Poland"],
  ["EWZ", "Brazylia (EWZ)", "MSCI Brazil"],
  ["EWJ", "Japonia (EWJ)", "MSCI Japan"],
  ["FXI", "Chiny — duże spółki (FXI)", "China Large-Cap"],
  ["INDA", "Indie (INDA)", "MSCI India"],
  ["EWG", "Niemcy (EWG)", "MSCI Germany"],
  ["EWU", "Wielka Brytania (EWU)", "MSCI UK"],
  ["EWY", "Korea Płd. (EWY)", "MSCI Korea"],
  ["EWT", "Tajwan (EWT)", "MSCI Taiwan"],
  ["EWW", "Meksyk (EWW)", "MSCI Mexico"],
  // inne
  ["UUP", "Dolar amerykański (UUP)", "indeks dolara"],
  ["VNQ", "Nieruchomości USA (VNQ)", "REIT-y"],
];

export const SCAN_CRYPTO: MarketAsset[] = CRYPTO.map(([symbol, label, id, yahoo], i) => ({
  symbol,
  label,
  assetClass: "crypto",
  currency: "USD",
  colorToken: slot(i),
  source: { kind: "coingecko", id, yahoo },
}));

export const SCAN_ETF: MarketAsset[] = ETF.map(([ticker, label, hint], i) => ({
  symbol: `${ticker}.US`,
  label,
  assetClass: "etf",
  currency: "USD",
  colorToken: slot(i + 3),
  source: { kind: "stooq", ticker: `${ticker.toLowerCase()}.us`, yahoo: ticker },
  hint,
}));
