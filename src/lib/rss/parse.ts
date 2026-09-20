// Wspólny parser RSS 2.0 dla modułów, które czytają newsy (paliwa, rynki).
//
// Wydzielony z src/lib/fuel/news.ts, gdzie powstał jako pierwszy — dwa
// moduły czytające te same kanały Google News nie potrzebują dwóch kopii
// tego samego, dość podstępnego parsowania (CDATA, encje, doklejana nazwa
// wydawcy w tytule).
//
// Świadomie bez nowej zależności na bibliotekę RSS: potrzebujemy czterech
// pól z prostego, dobrze określonego XML-a, a każdy dodatkowy pakiet w
// bundlu serwerowym to kolejna rzecz do aktualizowania. Parser jest
// defensywny — wejście pochodzi z zewnątrz i nigdy nie jest traktowane jak
// kod.

export type FeedSource = {
  tag: string;
  label: string;
  url: string;
};

/** Pozycja kanału, zanim moduł doklei do niej własną interpretację. */
export type RssItem = {
  guid: string;
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  feedTag: string;
};

/** Zapytanie do Google News jako kanał RSS. */
export function googleNewsFeed(query: string, lang: "en" | "pl"): string {
  const params = lang === "pl" ? "hl=pl&gl=PL&ceid=PL:pl" : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${params}`;
}

export function decodeEntities(text: string): string {
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
export function parseRss(xml: string, feed: FeedSource): RssItem[] {
  const items: RssItem[] = [];
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

export function normalizeTitle(title: string): string {
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
export function dedupeNews<T extends RssItem>(items: T[]): T[] {
  const byKey = new Map<string, T>();
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
