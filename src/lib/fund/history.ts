// FUNDUSZ — historia gracza jako „epizody” pozycji. Czysta logika.
//
// Transakcje silnika to kupna i sprzedaże (także dokupienia i częściowe
// redukcje przy zmianie pewności). Dla człowieka liczy się co innego:
// „kupił złoto 2.11 po 2 650 $, sprzedał 4.11 po 2 700 $, zarobił 380 zł”.
// Epizod = od otwarcia pozycji (z zera) do jej zamknięcia (z powrotem do
// zera) na jednym instrumencie. Ceny wejścia i wyjścia to średnie ważone
// liczbą jednostek, wynik = suma zrealizowanych wyników transakcji epizodu.

export type HistoryTrade = {
  executedOn: string;
  symbol: string;
  side: "buy" | "sell";
  /** Liczba jednostek (wartość bezwzględna). */
  units: number;
  /** Cena w walucie instrumentu. */
  price: number;
  notionalPln: number;
  /** Wynik zamknięcia (null = otwarcie / dokupienie). */
  realizedPln: number | null;
  reason: string | null;
};

export type Episode = {
  symbol: string;
  side: "long" | "short";
  openedOn: string;
  /** Średnia cena wejścia (waluta instrumentu). */
  entryPrice: number;
  /** Ile zainwestowano przy otwarciu i dokupieniach (PLN). */
  entryPln: number;
  closedOn: string | null;
  /** Średnia cena wyjścia; null, póki nic nie zamknięto. */
  exitPrice: number | null;
  realizedPln: number;
  /** Wynik zamkniętej części względem zainwestowanej kwoty (%), null = otwarta bez zamknięć. */
  returnPct: number | null;
  trades: number;
  /** Powód otwarcia (prognoza, która weszła). */
  reason: string | null;
};

const EPS = 1e-9;

/**
 * Transakcje (dowolna kolejność) → epizody, od najnowszego otwarcia.
 * W obrębie jednego dnia i instrumentu zamknięcia idą przed otwarciami —
 * baza nie trzyma kolejności w ciągu dnia, a silnik zawsze najpierw zamyka
 * (np. odwrócenie z długiej na krótką), potem otwiera.
 */
export function episodes(trades: readonly HistoryTrade[]): Episode[] {
  const sorted = [...trades].sort(
    (a, b) =>
      a.executedOn.localeCompare(b.executedOn) ||
      a.symbol.localeCompare(b.symbol) ||
      Number(a.realizedPln === null) - Number(b.realizedPln === null),
  );
  type Open = Episode & {
    units: number;
    inUnits: number;
    inValue: number;
    outUnits: number;
    outValue: number;
  };
  const open = new Map<string, Open>();
  const done: Episode[] = [];
  const finish = (e: Open) => {
    const { units: _u, inUnits: _iu, inValue: _iv, outUnits: _ou, outValue: _ov, ...rest } = e;
    done.push(rest);
  };

  for (const t of sorted) {
    const signed = t.side === "buy" ? t.units : -t.units;
    let cur = open.get(t.symbol);
    if (!cur) {
      if (t.units <= EPS) continue;
      cur = {
        symbol: t.symbol,
        side: signed > 0 ? "long" : "short",
        openedOn: t.executedOn,
        entryPrice: t.price,
        entryPln: 0,
        closedOn: null,
        exitPrice: null,
        realizedPln: 0,
        returnPct: null,
        trades: 0,
        reason: t.reason,
        units: 0,
        inUnits: 0,
        inValue: 0,
        outUnits: 0,
        outValue: 0,
      };
      open.set(t.symbol, cur);
    }
    cur.trades += 1;
    const adding = (cur.side === "long") === signed > 0;
    if (adding) {
      cur.units += signed;
      cur.inUnits += t.units;
      cur.inValue += t.units * t.price;
      cur.entryPln += t.notionalPln;
      cur.entryPrice = cur.inValue / cur.inUnits;
    } else {
      const held = Math.abs(cur.units);
      const closing = Math.min(held, t.units);
      cur.units += cur.side === "long" ? -closing : closing;
      cur.outUnits += closing;
      cur.outValue += closing * t.price;
      cur.exitPrice = cur.outValue / cur.outUnits;
      cur.realizedPln += t.realizedPln ?? 0;
      cur.returnPct = cur.entryPln > 0 ? (cur.realizedPln / cur.entryPln) * 100 : null;
      if (Math.abs(cur.units) <= Math.max(EPS, held * 1e-9)) {
        cur.closedOn = t.executedOn;
        finish(cur);
        open.delete(t.symbol);
        // odwrócenie w jednej transakcji: reszta otwiera nowy epizod
        const rest = t.units - closing;
        if (rest > held * 1e-6 && rest > EPS) {
          open.set(t.symbol, {
            symbol: t.symbol,
            side: signed > 0 ? "long" : "short",
            openedOn: t.executedOn,
            entryPrice: t.price,
            entryPln: t.notionalPln * (rest / t.units),
            closedOn: null,
            exitPrice: null,
            realizedPln: 0,
            returnPct: null,
            trades: 1,
            reason: t.reason,
            units: signed > 0 ? rest : -rest,
            inUnits: rest,
            inValue: rest * t.price,
            outUnits: 0,
            outValue: 0,
          });
        }
      }
    }
  }
  for (const e of open.values()) finish(e);
  return done.sort(
    (a, b) =>
      b.openedOn.localeCompare(a.openedOn) ||
      Number(a.closedOn !== null) - Number(b.closedOn !== null) ||
      a.symbol.localeCompare(b.symbol),
  );
}
