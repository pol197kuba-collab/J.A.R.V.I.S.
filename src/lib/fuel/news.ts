// Strumień newsów, które realnie ruszają cenami paliw: decyzje OPEC+,
// sankcje, awarie rafinerii, kursy ropy, krajowa akcyza i marże.
//
// Świadomie bez nowej zależności na parser RSS: potrzebujemy czterech pól
// z prostego, dobrze określonego XML-a, a każdy dodatkowy pakiet w bundlu
// serwerowym to kolejna rzecz do aktualizowania. Parser jest defensywny —
// wejście pochodzi z zewnątrz i nigdy nie jest traktowane jak kod.

export type FeedSource = {
  tag: string;
  label: string;
  url: string;
};

function googleNews(query: string, lang: "en" | "pl"): string {
  const params = lang === "pl" ? "hl=pl&gl=PL&ceid=PL:pl" : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${params}`;
}

export const FEEDS: readonly FeedSource[] = [
  { tag: "opec", label: "OPEC+", url: googleNews("OPEC production quota oil", "en") },
  { tag: "brent", label: "Brent", url: googleNews("Brent crude oil price", "en") },
  {
    tag: "supply",
    label: "Podaż",
    url: googleNews("refinery outage OR pipeline disruption oil", "en"),
  },
  {
    tag: "geo",
    label: "Geopolityka",
    url: googleNews("Russia oil sanctions OR Strait of Hormuz", "en"),
  },
  { tag: "pl", label: "Polska", url: googleNews("ceny paliw hurtowe Orlen akcyza", "pl") },
  { tag: "market", label: "Rynek", url: "https://oilprice.com/rss/main" },
] as const;

export type NewsItem = {
  guid: string;
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  feedTag: string;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

function tagContent(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return null;
  const raw = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return decodeEntities(stripTags(cdata ? cdata[1] : raw)).trim() || null;
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/**
 * Wyciąga pozycje z kanału RSS 2.0. Pozycje bez tytułu albo bez linku są
 * pomijane — bez nich wpis i tak nie nadaje się do pokazania.
 */
export function parseRss(xml: string, feed: FeedSource): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];

  for (const block of blocks) {
    const title = tagContent(block, "title");
    const link = tagContent(block, "link");
    if (!title || !link) continue;

    const guid = tagContent(block, "guid") ?? link;
    items.push({
      guid: guid.slice(0, 500),
      title: title.slice(0, 500),
      link,
      source: tagContent(block, "source") ?? feed.label,
      publishedAt: toIso(tagContent(block, "pubDate")),
      feedTag: feed.tag,
    });
  }

  return items;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[-–|]\s*[^-–|]{2,40}$/u, "") // Google News dokleja " - Reuters"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Odsiewa duplikaty: ten sam news trafia do nas z kilku zapytań, a Google
 * News dokleja do tytułu nazwę wydawcy. Zostaje wpis najnowszy.
 */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const byKey = new Map<string, NewsItem>();
  for (const item of items) {
    const key = normalizeTitle(item.title) || item.guid;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const a = existing.publishedAt ?? "";
    const b = item.publishedAt ?? "";
    if (b > a) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
}

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
