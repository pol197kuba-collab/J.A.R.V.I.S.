import { describe, expect, it } from "vitest";
import {
  ASSET_CLASS_LABELS,
  DEFAULT_WATCHLIST,
  MARKET_ASSETS,
  assetBySymbol,
  isKnownSymbol,
  searchAssets,
} from "./assets";

describe("MARKET_ASSETS", () => {
  it("has no duplicate symbols — the cache keys on them", () => {
    const symbols = MARKET_ASSETS.map((a) => a.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("assigns every asset a palette slot from the fixed market ramp", () => {
    // Kolor idzie za instrumentem, nie za pozycją na liście — ukrycie serii
    // nie może przemalować pozostałych, więc każdy token musi być z palety.
    for (const asset of MARKET_ASSETS) {
      expect(asset.colorToken).toMatch(/^var\(--market-[1-8]\)$/);
    }
  });

  it("labels every asset class it actually uses", () => {
    for (const asset of MARKET_ASSETS) {
      expect(ASSET_CLASS_LABELS[asset.assetClass]).toBeTruthy();
    }
  });

  it("gives every non-crypto, non-FX instrument a fallback provider", () => {
    // Stooq bywa niedostępny z serwerowni; bez drugiego dostawcy taki
    // instrument byłby po prostu pusty.
    for (const asset of MARKET_ASSETS) {
      if (asset.source.kind !== "stooq") continue;
      expect(asset.source.yahoo, `${asset.symbol} bez fallbacku`).toBeTruthy();
    }
  });

  it("seeds a watchlist made only of known symbols", () => {
    for (const symbol of DEFAULT_WATCHLIST) {
      expect(isKnownSymbol(symbol), symbol).toBe(true);
    }
  });
});

describe("assetBySymbol", () => {
  it("is case-insensitive and trims, because symbols arrive from the URL and DB", () => {
    expect(assetBySymbol(" btc ")?.label).toBe("Bitcoin");
    expect(assetBySymbol("cdr.pl")?.label).toBe("CD Projekt");
    expect(assetBySymbol("NIEISTNIEJE")).toBeUndefined();
  });
});

describe("searchAssets", () => {
  it("matches a Polish name typed without diacritics", () => {
    expect(searchAssets("zloto").map((a) => a.symbol)).toContain("XAUUSD");
  });

  it("matches on the symbol too", () => {
    expect(searchAssets("nvda").map((a) => a.symbol)).toEqual(["NVDA.US"]);
  });

  it("returns the whole catalog for an empty query", () => {
    expect(searchAssets("   ")).toHaveLength(MARKET_ASSETS.length);
  });
});

describe("fallback providers", () => {
  it("gives crypto a second provider too", () => {
    // Regresja na realną awarię na produkcji: CoinGecko zwrócił HTTP 429
    // (limit liczony na adres IP, który hosting dzieli) i Bitcoin z Ethereum
    // zniknęły z watchlisty, mimo że reszta zaciągnęła się poprawnie.
    for (const asset of MARKET_ASSETS) {
      if (asset.source.kind !== "coingecko") continue;
      expect(asset.source.yahoo, `${asset.symbol} bez fallbacku`).toBeTruthy();
    }
  });

  it("leaves FX with its single source, which is not rate-limited per IP", () => {
    const fx = MARKET_ASSETS.filter((a) => a.source.kind === "fx");
    expect(fx.length).toBeGreaterThan(0);
  });
});
