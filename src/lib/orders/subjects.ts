// Co wolno obserwować stałym rozkazem — jedna lista dla obu modułów.
//
// To jest miejsce styku dwóch słowników, które poza tym nic o sobie nie
// wiedzą: instrumentów z src/lib/markets/assets.ts i produktów paliwowych z
// src/lib/fuel/orlen.ts. Ewaluator i narzędzie agenta rozmawiają wyłącznie z
// tym plikiem, dzięki czemu dołożenie trzeciej dziedziny (gdyby kiedyś doszła
// pogoda albo kursy NBP) jest dopisaniem funkcji tutaj, a nie kolejnym `if`
// rozsianym po jobach.
//
// Plik jest CZYSTY (bez I/O), żeby ta sama lista służyła podpowiedziom w
// interfejsie, walidacji w server function i opisowi narzędzia agenta.
import { MARKET_ASSETS, assetBySymbol } from "@/lib/markets/assets";
import { ORLEN_PRODUCTS } from "@/lib/fuel/orlen";
import type { SubjectKind, SubjectLabels } from "./rules";

export type SubjectRef = {
  kind: SubjectKind;
  /** Kanoniczny identyfikator w obrębie dziedziny: symbol albo kod produktu. */
  id: string;
} & SubjectLabels;

/** Produkt paliwowy po kodzie — odpowiednik `assetBySymbol` po stronie paliw. */
export function fuelProductByCode(code: string) {
  const wanted = code.trim().toUpperCase();
  return ORLEN_PRODUCTS.find((p) => p.code === wanted);
}

/**
 * Rozpoznaje przedmiot rozkazu. Zwraca `null`, gdy nie należy do żadnego ze
 * słowników — rozkaz na coś, czego system nie zaciąga, nigdy by się nie
 * wyzwolił, więc lepiej odmówić założenia go, niż przyjąć i milczeć.
 */
export function resolveSubject(kind: SubjectKind, id: string): SubjectRef | null {
  if (kind === "market") {
    const asset = assetBySymbol(id.trim().toUpperCase());
    if (!asset) return null;
    return { kind, id: asset.symbol, label: asset.label, unit: asset.currency };
  }
  const product = fuelProductByCode(id);
  if (!product) return null;
  // Hurtowy cennik Orlenu jest w PLN za metr sześcienny netto — tak, jak
  // zwraca go API. Nie przeliczamy na litry, bo próg podany przez
  // użytkownika ma znaczyć to samo, co liczba widoczna w module.
  return { kind, id: product.code, label: product.label, unit: "PLN/m³" };
}

/** Wszystko, co da się objąć rozkazem — do podpowiedzi i do opisu narzędzia. */
export function listSubjects(): SubjectRef[] {
  return [
    ...MARKET_ASSETS.map(
      (a): SubjectRef => ({
        kind: "market",
        id: a.symbol,
        label: a.label,
        unit: a.currency,
      }),
    ),
    ...ORLEN_PRODUCTS.map(
      (p): SubjectRef => ({ kind: "fuel", id: p.code, label: p.label, unit: "PLN/m³" }),
    ),
  ];
}

/** Etykiety dla meldunku; przedmiot nieznany opisujemy samym identyfikatorem. */
export function labelsFor(kind: SubjectKind, id: string): SubjectLabels {
  return resolveSubject(kind, id) ?? { label: id, unit: "" };
}
