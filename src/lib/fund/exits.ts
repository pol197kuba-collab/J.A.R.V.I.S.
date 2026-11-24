// FUNDUSZ — progi stop-loss / take-profit otwartej pozycji jako ceny.
// Czysta logika (testy w exits.test.ts).
//
// Silnik trzyma progi jako ułamek ruchu od ceny odniesienia (wejście albo
// ostatnie potwierdzenie prognozą): długa zamyka się przy refPx·(1−stop)
// i refPx·(1+take), krótka odwrotnie. Dla człowieka liczy się cena progu
// i ile rynek musi się jeszcze ruszyć od obecnej ceny, żeby go trafić.

export type ExitLevel = {
  /** Cena progu w walucie instrumentu. */
  price: number;
  /** Ruch ceny od obecnej do progu (%, ze znakiem); null bez obecnej ceny. */
  distancePct: number | null;
};

export type ExitLevels = { stop: ExitLevel | null; take: ExitLevel | null };

export function exitLevels(
  side: "long" | "short",
  refPx: number | null,
  stop: number | null,
  take: number | null,
  last: number | null,
): ExitLevels {
  if (refPx === null || !Number.isFinite(refPx) || refPx <= 0) return { stop: null, take: null };
  const dir = side === "long" ? 1 : -1;
  const level = (frac: number | null, sign: 1 | -1): ExitLevel | null => {
    if (frac === null || !Number.isFinite(frac) || frac <= 0) return null;
    const price = refPx * (1 + sign * dir * frac);
    const distancePct =
      last !== null && Number.isFinite(last) && last > 0 ? (price / last - 1) * 100 : null;
    return { price, distancePct };
  };
  return { stop: level(stop, -1), take: level(take, 1) };
}
