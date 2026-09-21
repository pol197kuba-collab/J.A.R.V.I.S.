// Strumień newsów, które realnie ruszają cenami paliw: decyzje OPEC+,
// sankcje, awarie rafinerii, kursy ropy, krajowa akcyza i marże.
//
// Samo parsowanie RSS-a mieszka w src/lib/rss/parse.ts — ten sam kod czyta
// kanały dla modułu /rynki, więc nie ma tu jego drugiej kopii. Zostaje to,
// co jest specyficzne dla paliw: dobór kanałów i słownik oceny wpływu.
import type { FeedSource, RssItem } from "@/lib/rss/parse";

export { dedupeNews, parseRss } from "@/lib/rss/parse";
export type { FeedSource } from "@/lib/rss/parse";

/** Pozycja newsowa modułu paliwowego — dziś dokładnie kształt z RSS-a. */
export type NewsItem = RssItem;

// ŹRÓDŁA WYDAWCÓW, NIE GOOGLE NEWS.
//
// Pięć z sześciu kanałów odpytywało wcześniej Google News. Na produkcji
// wszystkie zwracały HTTP 503 przy każdym zaciągu — Google odrzuca ruch z
// adresów IP centrów danych, a aplikacja stoi właśnie na takim. Wykryte
// dopiero w module /rynki (te same kanały, te same 503 w System Logs), bo
// tutaj awaria była cicha: ceny pokazywały się normalnie, a panel newsów
// świecił pustką, którą łatwo wziąć za brak ciekawych wiadomości.
//
// Każdy kanał poniżej sprawdzony realnym żądaniem z serwerowni. Dobór
// trzyma się tematyki modułu: to, co rusza HURTOWĄ ceną paliwa w Polsce —
// ropa i OPEC, notowania surowców, krajowa energetyka i akcyza, oraz kurs
// dolara, w którym rozliczana jest ropa.
export const FEEDS: readonly FeedSource[] = [
  // Globalna ropa: OPEC, awarie rafinerii, sankcje, Ormuz.
  { tag: "oil", label: "Ropa (OilPrice)", url: "https://oilprice.com/rss/main" },
  {
    tag: "commodities",
    label: "Surowce",
    url: "https://www.investing.com/rss/commodities.rss",
  },
  // Polska perspektywa — dokładnie to, czego nie opisują serwisy anglojęzyczne.
  { tag: "ropa-pl", label: "Ropa (PL)", url: "https://biznesalert.pl/category/ropa/feed/" },
  {
    tag: "energia-pl",
    label: "Energetyka (PL)",
    url: "https://biznesalert.pl/category/energetyka/feed/",
  },
  // Kurs dolara: ropa jest w USD, więc słabszy złoty podnosi cenę w PLN
  // niezależnie od notowań samego surowca.
  { tag: "fx", label: "Waluty", url: "https://www.investing.com/rss/news_11.rss" },
] as const;

export type Impact = "bullish" | "bearish" | "neutral";

export type ImpactVerdict = {
  impact: Impact;
  /** 0-100 — jak mocno news może ruszyć ceną. */
  score: number;
  summaryPl: string | null;
  classifiedBy: "gemini" | "heuristic";
};

// „bullish" = w górę dla ceny paliwa (ograniczenie podaży, ryzyko),
// „bearish" = w dół (nadpodaż, słabnący popyt, deeskalacja).
const BULLISH = [
  "cut",
  "cuts",
  "outage",
  "sanction",
  "attack",
  "strike",
  "disruption",
  "halt",
  "shutdown",
  "fire",
  "drone",
  "embargo",
  "shortage",
  "surge",
  "rally",
  "jump",
  "tension",
  "escalat",
  "hurricane",
  "blockade",
  // Polskie formy zapisane RDZENIAMI, nie mianownikiem. Dopasowanie idzie
  // przez `includes`, więc "wzrost" łapie "wzrostów", ale "spadek" NIE łapie
  // "spadają" — a to właśnie ta asymetria przekłamywała kierunek. Realny
  // przypadek z kanału BiznesAlert: "Ceny ropy w końcu spadają po dwóch
  // tygodniach wzrostów" wychodziło jako wzrostowe, bo jedyne trafienie
  // dawał rdzeń "wzrost".
  "cięcia",
  "awaria",
  "sankcje",
  "atak",
  "przerwa",
  "wzrost",
  "wzrosł",
  "rosną",
  "rośnie",
  "podwyżka",
  "podwyż",
  "drożeje",
  "drożeją",
  "ryzyko",
];
const BEARISH = [
  "increase output",
  "boost output",
  "raise output",
  "oversupply",
  "glut",
  "slump",
  "plunge",
  "fall",
  "drop",
  "decline",
  "ceasefire",
  "truce",
  "deal",
  "easing",
  "release reserves",
  "recession",
  "demand weak",
  "spadek",
  "spadki",
  "spadają",
  "spada",
  "spadł",
  "obniżka",
  "obniż",
  "rozejm",
  "porozumienie",
  "nadpodaż",
  "taniej",
  "tanieje",
  "tanieją",
  "słabszy popyt",
];
const HIGH_IMPACT = ["opec", "sanction", "embargo", "hormuz", "russia", "war", "strike", "sankcje"];

/**
 * Zapasowa ocena wpływu, gdy nie ma klucza Gemini albo model zawiódł.
 * Prosty słownik — celowo konserwatywna: przy braku sygnału mówi „neutral"
 * zamiast zgadywać kierunek.
 */
export function heuristicImpact(title: string): ImpactVerdict {
  const text = title.toLowerCase();
  const bull = BULLISH.filter((w) => text.includes(w)).length;
  const bear = BEARISH.filter((w) => text.includes(w)).length;
  const weighty = HIGH_IMPACT.some((w) => text.includes(w));

  let impact: Impact = "neutral";
  if (bull > bear) impact = "bullish";
  else if (bear > bull) impact = "bearish";

  const strength = Math.abs(bull - bear);
  const score =
    impact === "neutral"
      ? weighty
        ? 35
        : 20
      : Math.min(90, 40 + strength * 15 + (weighty ? 15 : 0));

  return { impact, score, summaryPl: null, classifiedBy: "heuristic" };
}
