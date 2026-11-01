// FUNDUSZ — proste podsumowanie graczy: co kupili, co sprzedali, co dało
// zysk, co stratę. Każdy osobno i wszyscy w jednej tabeli. Czysta logika.
//
// Wynik w zł = zrealizowany (zamknięte transakcje, po kosztach obu stron) +
// niezrealizowany (otwarte pozycje: wartość − koszt). Ta suma to dokładnie
// wycena − 100 000 zł, więc podsumowanie zgadza się z rankingiem co do grosza
// (z dokładnością do zaokrągleń w bazie).

export type SummaryOrder = {
  symbol: string;
  side: "buy" | "sell";
  notionalPln: number;
  feePln: number;
  /** Zysk/strata zamknięcia (sprzedaż długiej albo odkup krótkiej); null = otwarcie. */
  realizedPln: number | null;
};

/** Krótka: valuePln < 0 i costPln < 0 — wynik nadal = value − cost. */
export type SummaryPosition = { symbol: string; valuePln: number; costPln: number };

export type SymbolResult = {
  symbol: string;
  realizedPln: number;
  unrealizedPln: number;
  totalPln: number;
  trades: number;
  /** Otwarta pozycja na koniec: długa, krótka albo brak. */
  open: "long" | "short" | null;
};

export type PlayerSummary = {
  buys: number;
  sells: number;
  boughtPln: number;
  soldPln: number;
  /** Transakcje zamykające (z wynikiem) i ile z nich na plusie. */
  closed: number;
  wins: number;
  realizedPln: number;
  unrealizedPln: number;
  totalPln: number;
  feesPln: number;
  /** Najlepszy i najgorszy instrument (null, gdy nic nie zarobił / nie stracił). */
  best: SymbolResult | null;
  worst: SymbolResult | null;
  /** Wszystkie instrumenty, od największego zysku do największej straty. */
  bySymbol: SymbolResult[];
};

export function summarizePlayer(
  orders: SummaryOrder[],
  positions: SummaryPosition[],
): PlayerSummary {
  const map = new Map<string, SymbolResult>();
  const row = (symbol: string): SymbolResult => {
    let r = map.get(symbol);
    if (!r) {
      r = { symbol, realizedPln: 0, unrealizedPln: 0, totalPln: 0, trades: 0, open: null };
      map.set(symbol, r);
    }
    return r;
  };

  let buys = 0;
  let sells = 0;
  let boughtPln = 0;
  let soldPln = 0;
  let closed = 0;
  let wins = 0;
  let feesPln = 0;
  for (const o of orders) {
    const r = row(o.symbol);
    r.trades += 1;
    feesPln += o.feePln;
    if (o.side === "buy") {
      buys += 1;
      boughtPln += o.notionalPln;
    } else {
      sells += 1;
      soldPln += o.notionalPln;
    }
    if (o.realizedPln !== null) {
      closed += 1;
      if (o.realizedPln > 0) wins += 1;
      r.realizedPln += o.realizedPln;
    }
  }
  for (const p of positions) {
    const r = row(p.symbol);
    r.unrealizedPln += p.valuePln - p.costPln;
    r.open = p.valuePln < 0 ? "short" : "long";
  }

  const bySymbol = [...map.values()]
    .map((r) => ({ ...r, totalPln: r.realizedPln + r.unrealizedPln }))
    .sort((a, b) => b.totalPln - a.totalPln || a.symbol.localeCompare(b.symbol));
  const realizedPln = bySymbol.reduce((s, r) => s + r.realizedPln, 0);
  const unrealizedPln = bySymbol.reduce((s, r) => s + r.unrealizedPln, 0);
  const first = bySymbol[0];
  const last = bySymbol[bySymbol.length - 1];

  return {
    buys,
    sells,
    boughtPln,
    soldPln,
    closed,
    wins,
    realizedPln,
    unrealizedPln,
    totalPln: realizedPln + unrealizedPln,
    feesPln,
    best: first && first.totalPln > 0 ? first : null,
    worst: last && last.totalPln < 0 ? last : null,
    bySymbol,
  };
}

export type ComparisonRow = {
  symbol: string;
  /** Klucz gracza → wynik w zł; brak klucza = gracz nie grał tym instrumentem. */
  byPlayer: Record<string, number>;
  /** Suma wszystkich graczy-źródeł (bez odniesień) — czy ten instrument w ogóle się opłacał. */
  sourcesTotalPln: number;
};

/**
 * Tabela instrument × gracz. Kolejność: instrumenty, na których gracze-źródła
 * razem stracili najwięcej, na górze — tam jest problem do zrozumienia.
 */
export function compareBySymbol(
  summaries: Record<string, PlayerSummary>,
  sourceKeys: string[],
): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();
  for (const [key, s] of Object.entries(summaries)) {
    for (const r of s.bySymbol) {
      const row = rows.get(r.symbol) ?? { symbol: r.symbol, byPlayer: {}, sourcesTotalPln: 0 };
      row.byPlayer[key] = r.totalPln;
      if (sourceKeys.includes(key)) row.sourcesTotalPln += r.totalPln;
      rows.set(r.symbol, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.sourcesTotalPln - b.sourcesTotalPln || a.symbol.localeCompare(b.symbol),
  );
}
