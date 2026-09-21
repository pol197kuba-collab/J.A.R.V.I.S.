import { describe, expect, it } from "vitest";
import { FEEDS, dedupeNews, heuristicImpact, parseRss, type NewsItem } from "./news";

const FEED = FEEDS[0];

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>"oil prices" - Google News</title>
  <item>
    <title>OPEC+ agrees to deepen output cuts &amp; extend them</title>
    <link>https://example.com/a</link>
    <guid isPermaLink="false">CBMiK2h0dHBz</guid>
    <pubDate>Fri, 19 Sep 2026 12:30:00 GMT</pubDate>
    <source url="https://reuters.com">Reuters</source>
  </item>
  <item>
    <title><![CDATA[Oil <b>slumps</b> as demand outlook weakens]]></title>
    <link>https://example.com/b</link>
    <pubDate>Thu, 18 Sep 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Bez linku</title>
  </item>
</channel></rss>`;

describe("parseRss", () => {
  it("wyciąga tytuł, link, guid, źródło i datę", () => {
    const items = parseRss(SAMPLE_RSS, FEED);
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      title: "OPEC+ agrees to deepen output cuts & extend them",
      link: "https://example.com/a",
      guid: "CBMiK2h0dHBz",
      source: "Reuters",
      feedTag: FEED.tag,
    });
    expect(items[0].publishedAt).toBe("2026-09-19T12:30:00.000Z");
  });

  it("rozpakowuje CDATA, zdejmuje tagi i podstawia etykietę kanału", () => {
    const items = parseRss(SAMPLE_RSS, FEED);
    expect(items[1].title).toBe("Oil slumps as demand outlook weakens");
    expect(items[1].source).toBe(FEED.label);
    // Brak <guid> → kluczem deduplikacji zostaje link.
    expect(items[1].guid).toBe("https://example.com/b");
  });

  it("pomija pozycje bez linku i nie wywraca się na śmieciach", () => {
    expect(parseRss(SAMPLE_RSS, FEED).some((i) => i.title === "Bez linku")).toBe(false);
    expect(parseRss("to nie jest XML", FEED)).toEqual([]);
    expect(parseRss("", FEED)).toEqual([]);
  });
});

describe("dedupeNews", () => {
  const base: NewsItem = {
    guid: "1",
    title: "Oil prices jump after refinery outage",
    link: "https://example.com/1",
    source: "Reuters",
    publishedAt: "2026-09-19T10:00:00.000Z",
    feedTag: "brent",
  };

  it("scala ten sam news z różnych kanałów mimo doklejonego wydawcy", () => {
    const merged = dedupeNews([
      base,
      {
        ...base,
        guid: "2",
        title: "Oil prices jump after refinery outage - Reuters",
        feedTag: "supply",
        publishedAt: "2026-09-19T11:00:00.000Z",
      },
    ]);
    expect(merged).toHaveLength(1);
    // Wygrywa nowsza wersja wpisu.
    expect(merged[0].guid).toBe("2");
  });

  it("zostawia różne newsy i sortuje od najnowszego", () => {
    const merged = dedupeNews([
      { ...base, guid: "old", publishedAt: "2026-09-10T10:00:00.000Z" },
      {
        ...base,
        guid: "new",
        title: "OPEC+ extends cuts",
        publishedAt: "2026-09-19T10:00:00.000Z",
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].guid).toBe("new");
  });
});

describe("heuristicImpact — polska odmiana", () => {
  it("nie czyta spadku ceny jako wzrostu", () => {
    // Realny nagłówek z kanału BiznesAlert, na którym to wyszło: słownik
    // znał rdzeń "wzrost" (trafiał w "wzrostów"), ale nie znał "spadają",
    // więc news o TANIEJĄCEJ ropie wychodził jako wzrostowy.
    const v = heuristicImpact("Ceny ropy w końcu spadają po dwóch tygodniach wzrostów");
    expect(v.impact).not.toBe("bullish");
  });

  it("rozpoznaje potoczne formy w obie strony", () => {
    expect(heuristicImpact("Paliwo tanieje na stacjach").impact).toBe("bearish");
    expect(heuristicImpact("Ceny ropy rosną po decyzji OPEC").impact).toBe("bullish");
    expect(heuristicImpact("Hurtowe ceny spadają trzeci dzień").impact).toBe("bearish");
    expect(heuristicImpact("Drożeje diesel w hurcie").impact).toBe("bullish");
  });
});

describe("heuristicImpact", () => {
  it("rozpoznaje sygnał wzrostowy", () => {
    const verdict = heuristicImpact("Refinery outage halts supply after drone attack");
    expect(verdict.impact).toBe("bullish");
    expect(verdict.score).toBeGreaterThan(50);
    expect(verdict.classifiedBy).toBe("heuristic");
  });

  it("rozpoznaje sygnał spadkowy", () => {
    expect(heuristicImpact("Oil prices plunge as OPEC members boost output").impact).toBe(
      "bearish",
    );
  });

  it("przy braku sygnału mówi 'neutral' zamiast zgadywać kierunek", () => {
    const verdict = heuristicImpact("Nowa stacja paliw otwarta w Kutnie");
    expect(verdict.impact).toBe("neutral");
    expect(verdict.score).toBeLessThan(40);
    expect(verdict.summaryPl).toBeNull();
  });

  it("podbija wagę tematów systemowych", () => {
    const weighty = heuristicImpact("OPEC meeting ends without decision");
    const plain = heuristicImpact("Local fuel station reopens");
    expect(weighty.score).toBeGreaterThan(plain.score);
  });
});
