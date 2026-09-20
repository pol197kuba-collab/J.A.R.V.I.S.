// Strumień newsów, które realnie ruszają cenami paliw: decyzje OPEC+,
// sankcje, awarie rafinerii, kursy ropy, krajowa akcyza i marże.
//
// Samo parsowanie RSS-a mieszka w src/lib/rss/parse.ts — ten sam kod czyta
// kanały dla modułu /rynki, więc nie ma tu jego drugiej kopii. Zostaje to,
// co jest specyficzne dla paliw: dobór kanałów i słownik oceny wpływu.
import { googleNewsFeed, type FeedSource, type RssItem } from "@/lib/rss/parse";

export { dedupeNews, parseRss } from "@/lib/rss/parse";
export type { FeedSource } from "@/lib/rss/parse";

/** Pozycja newsowa modułu paliwowego — dziś dokładnie kształt z RSS-a. */
export type NewsItem = RssItem;

export const FEEDS: readonly FeedSource[] = [
  { tag: "opec", label: "OPEC+", url: googleNewsFeed("OPEC production quota oil", "en") },
  { tag: "brent", label: "Brent", url: googleNewsFeed("Brent crude oil price", "en") },
  {
    tag: "supply",
    label: "Podaż",
    url: googleNewsFeed("refinery outage OR pipeline disruption oil", "en"),
  },
  {
    tag: "geo",
    label: "Geopolityka",
    url: googleNewsFeed("Russia oil sanctions OR Strait of Hormuz", "en"),
  },
  { tag: "pl", label: "Polska", url: googleNewsFeed("ceny paliw hurtowe Orlen akcyza", "pl") },
  { tag: "market", label: "Rynek", url: "https://oilprice.com/rss/main" },
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
  "cięcia",
  "awaria",
  "sankcje",
  "atak",
  "przerwa",
  "wzrost",
  "podwyżka",
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
  "obniżka",
  "rozejm",
  "porozumienie",
  "nadpodaż",
  "taniej",
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
