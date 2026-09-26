// F.O.R.G.E. — renderery plików (pptx / docx).
//
// Czyste funkcje z opisu na bajty, trzymane osobno od okablowania narzędzia w
// tools.server.ts, żeby dało się je testować bez kontekstu Supabase. Oba
// formaty są czysto javascriptowe (pptxgenjs, docx) zgodnie z zasadą repo
// „TypeScript first" — zero zależności natywnych, działa w istniejącym
// runtime funkcji serwerowych.
//
// Dwa formaty, dwa renderery, zero wspólnego kodu układu — bo prezentacja to
// płótno ze współrzędnymi, a dokument to płyn, w którym tekst łamie się sam.
// Wspólne są tylko: opis (./docSpec) i motyw (./docTheme).
//
// Oba formaty jedynie REFERENCUJĄ kroje pisma — glify dokłada program, który
// otwiera plik — więc żaden nie potrzebuje osadzania fontów. Nieistniejąca
// już ścieżka PDF potrzebowała: wbudowane kroje pdf-liba są w WinAnsi i
// wywracały się na pierwszym polskim ogonku, więc trzeba było wozić ze sobą
// podzbiór TTF-a i fontkit. Zniknęła razem z formatem.

import PptxGen from "pptxgenjs";

/**
 * KONSTRUKTOR WYŁUSKANY RĘCZNIE, A NIE WZIĘTY WPROST Z IMPORTU.
 *
 * `pptxgenjs` wysyła dwie postacie tego samego kodu: ESM-ową, która robi
 * `export { PptxGenJS as default }`, i CommonJS-ową, która robi
 * `module.exports = PptxGenJS`. Obie są poprawne. Problem powstaje o jeden
 * poziom wyżej: przy zamianie CommonJS-u na moduł pakujący owija eksport w
 * obiekt, i wtedy pod domyślnym importem nie leży klasa, tylko `{ default:
 * klasa }`. `new` na takim obiekcie kończy się zdaniem „PptxGen is not a
 * constructor" — i dokładnie to zobaczył użytkownik, mimo że biblioteka,
 * jej wersja i kod budujący prezentację były bez zmian.
 *
 * Czego to NIE jest: to nie jest błąd `pptxgenjs` ani skutek aktualizacji
 * (4.0.1 był i jest najnowszy). To skutek tego, w którą postać trafi
 * pakowanie — a ta potrafi się zmienić przy przebudowie, bez żadnej zmiany
 * w zależnościach. Dlatego nie „naprawiamy konfiguracji pakowania" tylko
 * przyjmujemy OBIE postacie: kod, który działa niezależnie od tego, co
 * akurat wyszło z bundlera, nie może się na tym wywrócić drugi raz.
 */
export function unwrapDefault<T>(mod: T): T {
  if (typeof mod === "function") return mod;
  const wrapped = (mod as { default?: T } | null)?.default;
  return wrapped ?? mod;
}

const PptxGenClass: typeof PptxGen = unwrapDefault(PptxGen);
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { isOnTopic } from "./imageRelevance";
import { DEFAULT_GEMINI_MODEL } from "./models";
import { DOC_COLORS, DOC_FONTS, DECK_SLIDE } from "./docTheme";
import {
  blocksOf,
  MAX_SECTION_IMAGES,
  type DeckSlide,
  type DeckSpec,
  type DocSpec,
  type ProducerSpec,
} from "./docSpec";

// Typy i walidacja opisu mieszkają w ./docSpec (plik czysty, bez zależności
// serwerowych — czyta go też podgląd w przeglądarce). Re-eksport zostaje,
// żeby konsumenci tego modułu nie musieli wiedzieć, że coś się przeprowadziło.
export * from "./docSpec";

// ---------------------------------------------------------------------------
// AI slide graphics — Gemini image generation on the user's own key
// ---------------------------------------------------------------------------

export type DocImage = {
  bytes: Uint8Array;
  mime: string;
  /** Adres, spod którego zdjęcie faktycznie przyszło (po przekierowaniach).
   *  Nie jest ozdobą: to on pozwala podglądowi pokazać TO SAMO zdjęcie, które
   *  siedzi w pliku, nie trzymając ani jednego dodatkowego bajtu w storage.
   *  Odkąd wszystkie obrazy pochodzą z sieci, każdy taki adres istnieje. */
  sourceUrl: string;
};
export type DocImages = { hero?: DocImage; sections: Map<number, DocImage> };

// ---------------------------------------------------------------------------
// Real web photos — Openverse (Creative Commons image search, no API key)
// ---------------------------------------------------------------------------

// Stage 2: real photos instead of AI graphics. The AI image model is chronic-
// ally 503-throttled for some keys, so a genuine photo (Openverse, CC-licensed)
// is the reliable path when the content is a real thing (a product, place,
// person). Openverse is keyless with modest anonymous rate limits — plenty for
// a handful of images per deck. Best-effort: no result / a bad fetch just
// leaves that slide text-only.
const MAX_WEB_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const WEB_IMAGE_TIMEOUT_MS = 10_000;

/**
 * Nagłówek zgodny z polityką Wikimediów: nazwa narzędzia i adres kontaktowy.
 * Gołe „Nazwa/1.0" bywa traktowane jak ruch anonimowego bota i dostaje 429.
 */
const USER_AGENT = "JARVIS-Forge/1.0 (https://github.com/pol197kuba-collab/J.A.R.V.I.S.)";

/**
 * Notatka z jednej warstwy szukania obrazu.
 *
 * ISTNIEJE PO TO, ŻEBY NIEPOWODZENIE MIAŁO TREŚĆ. Wcześniej cztery warstwy
 * (Google CSE, Wikipedia, og:image, Openverse) mogły odpaść z czterech
 * zupełnie różnych powodów, a do logu trafiało jedno zdanie: „no image
 * resolved". Nie dało się z niego odczytać ani CZEGO szukano, ani KTÓRA
 * warstwa i DLACZEGO odpadła — więc diagnoza wymagała zgadywania zamiast
 * czytania. Teraz każda warstwa zostawia po sobie krótki ślad.
 */
type Note = (text: string) => void;

async function fetchWebImage(query: string, note: Note): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const searchUrl =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
      `&license_type=all&mature=false&page_size=3`;
    const res = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    // Zwraca null jak każda inna warstwa, zamiast rzucać. Wyjątek z
    // OSTATNIEJ warstwy przewracał całe szukanie obrazu i zamieniał
    // „ta warstwa nie znalazła" w „zadanie się wysypało".
    if (!res.ok) {
      note(`openverse: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ url?: string; filetype?: string; title?: string }>;
    };
    const hits = data.results ?? [];
    if (hits.length === 0) {
      // Openverse indeksuje wyłącznie treści anglojęzyczne — zapytanie po
      // polsku zwraca tutaj zero i to jest najczęstsza przyczyna pustki.
      note("openverse: 0 wyników");
      return null;
    }
    let offTopic = 0;
    for (const hit of hits) {
      if (!isOnTopic(query, hit.title)) {
        offTopic++;
        continue;
      }
      const url = hit.url;
      // Only fetch https from a public host — never a private/loopback target.
      if (!url || !/^https:\/\//i.test(url)) continue;
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
        continue;
      }
      try {
        const imgRes = await fetch(url, {
          signal: ctrl.signal,
          headers: { "User-Agent": USER_AGENT },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0], sourceUrl: imgRes.url };
      } catch {
        continue; // try the next candidate
      }
    }
    note(
      offTopic === hits.length
        ? `openverse: ${hits.length} wyników, żaden nie o tym`
        : `openverse: ${hits.length} wyników, żadnego nie dało się pobrać`,
    );
    return null;
  } catch (err) {
    note(`openverse: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Real web photos — Wikipedia/Wikimedia (broader than Openverse's CC-only
// index, still keyless, no scraping)
// ---------------------------------------------------------------------------

// Openverse only indexes Creative-Commons-licensed images, which essentially
// never exist for a specific branded/newly-released subject (a game, a
// gadget, a car model) — official promotional screenshots and box art are
// copyrighted, not CC-licensed, so Openverse reliably returns nothing for
// exactly the subjects users most want a real photo of. Wikipedia articles
// for well-known, named subjects (games, products, places, people) almost
// always carry a real, on-topic infobox image, hosted directly on Wikimedia's
// own CDN — no scraping, one search call + one summary call, both public,
// keyless JSON endpoints. This is a deliberate, user-confirmed tradeoff for
// this personal/non-commercial project: the embedded image may be under
// standard copyright (fair-use rationale on Wikipedia's side, not a CC
// license), which is why it's tried BEFORE Openverse's clean-license search,
// not instead of it — Openverse still gets a turn for generic/decorative
// queries that have real CC alternatives.
async function fetchWikipediaImage(
  query: string,
  lang: "en" | "pl",
  note: Note,
): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const searchUrl =
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&list=search&srlimit=1&srsearch=${encodeURIComponent(query)}`;
    const searchRes = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!searchRes.ok) {
      note(`wikipedia:${lang} HTTP ${searchRes.status}`);
      return null;
    }
    const searchData = (await searchRes.json()) as {
      query?: { search?: Array<{ title?: string }> };
    };
    const title = searchData.query?.search?.[0]?.title;
    if (!title) {
      note(`wikipedia:${lang} brak artykułu`);
      return null;
    }
    // Wyszukiwarka ZAWSZE coś zwróci — dla „Rockstar Games logo office"
    // zwróciła „Rockstar Leeds". Bez tego sprawdzenia zdjęcie z takiego
    // artykułu ląduje na slajdzie jako ilustracja czegoś innego.
    if (!isOnTopic(query, title)) {
      note(`wikipedia:${lang} „${title}" nie o tym`);
      return null;
    }

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      },
    );
    if (!summaryRes.ok) {
      note(`wikipedia:${lang} streszczenie HTTP ${summaryRes.status}`);
      return null;
    }
    const summary = (await summaryRes.json()) as {
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
    };
    const imageUrl = summary.originalimage?.source ?? summary.thumbnail?.source;
    if (!imageUrl || !/^https:\/\/upload\.wikimedia\.org\//i.test(imageUrl)) {
      note(`wikipedia:${lang} „${title}" bez zdjęcia`);
      return null;
    }

    const imgRes = await fetch(imageUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!imgRes.ok) {
      note(`wikipedia:${lang} pobranie zdjęcia HTTP ${imgRes.status}`);
      return null;
    }
    const mime = imgRes.headers.get("content-type") ?? "";
    if (!mime.startsWith("image/")) return null;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) return null;
    return { bytes: buf, mime: mime.split(";")[0], sourceUrl: imgRes.url };
  } catch (err) {
    note(`wikipedia:${lang} ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Real web photos — Google Custom Search (optional, user-provided key)
// ---------------------------------------------------------------------------

export type GoogleCseCreds = { apiKey: string; cx: string };

// Self-serve upgrade: with no credentials configured this tier is simply
// skipped (see resolveOneImage). When a user sets one up (Settings →
// console.cloud.google.com, 100 free queries/day), it's the most accurate
// and broadest real-photo source available, so it goes first.
async function fetchGoogleCseImage(
  query: string,
  creds: GoogleCseCreds,
  note: Note,
): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(creds.apiKey)}` +
      `&cx=${encodeURIComponent(creds.cx)}&q=${encodeURIComponent(query)}` +
      `&searchType=image&num=3&safe=active`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      note(`cse: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { items?: Array<{ link?: string; title?: string }> };
    const items = data.items ?? [];
    if (items.length === 0) {
      note("cse: 0 wyników");
      return null;
    }
    let cseOffTopic = 0;
    for (const item of items) {
      const link = item.link;
      if (!link || !/^https:\/\//i.test(link)) continue;
      if (!isOnTopic(query, item.title)) {
        cseOffTopic++;
        continue;
      }
      try {
        const imgRes = await fetch(link, {
          signal: ctrl.signal,
          headers: { "User-Agent": USER_AGENT },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0], sourceUrl: imgRes.url };
      } catch {
        continue; // try the next candidate
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Real web photos — free, whole-internet fallback via og:image scraping
// ---------------------------------------------------------------------------

const OG_IMAGE_TIMEOUT_MS = 12_000;
const OG_IMAGE_TAG_RE =
  /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i;

// Free, keyless "search the whole web for a real photo" tier: reuses the
// same google_search grounding Gemini call the web_search tool already
// makes to get real page URLs for the query, then reads each candidate
// page's <meta property="og:image"> (or twitter:image) tag — the standard
// preview-image convention nearly every content site, wiki, store, and news
// outlet sets — and embeds that image directly. No scraping of page bodies,
// no third-party search API, no signup: only the two calls the project
// already makes elsewhere (Gemini grounding, a plain fetch).
async function fetchWebSearchOgImage(
  query: string,
  geminiApiKey: string,
  note: Note,
): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OG_IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { temperature: 0, maxOutputTokens: 50 },
          tools: [{ google_search: {} }],
          contents: [{ role: "user", parts: [{ text: query }] }],
        }),
      },
    );
    if (!res.ok) {
      note(`og-image: wyszukiwarka HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
      }>;
    };
    const urls = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .flatMap((c) => (c.web?.uri ? [c.web.uri] : []))
      .slice(0, 4);
    if (urls.length === 0) {
      note("og-image: wyszukiwarka nie zwróciła stron");
      return null;
    }

    let offTopicPages = 0;
    for (const pageUrl of urls) {
      try {
        const pageRes = await fetch(pageUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": USER_AGENT },
        });
        if (!pageRes.ok) continue;
        const contentType = pageRes.headers.get("content-type") ?? "";
        if (!contentType.includes("html")) continue;
        // Only the <head> realistically needs reading for a meta tag — caps
        // download size for pages that don't stream-truncate cleanly.
        const html = (await pageRes.text()).slice(0, 60_000);
        // Tytuł strony to jedyne, co o tym kandydacie wiadomo — i musi
        // mówić o temacie. Bez tego bierzemy pierwszą stronę, którą
        // wyszukiwarka skojarzyła luźno, i jej zdjęcie otwierające.
        const pageTitle = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1];
        if (!isOnTopic(query, pageTitle)) {
          offTopicPages++;
          continue;
        }
        const match = OG_IMAGE_TAG_RE.exec(html);
        const imageUrl = match?.[1];
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) continue;

        const imgRes = await fetch(imageUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": USER_AGENT },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0], sourceUrl: imgRes.url };
      } catch {
        continue; // try the next candidate page
      }
    }
    note(
      offTopicPages === urls.length
        ? `og-image: ${urls.length} stron nie o tym`
        : `og-image: ${urls.length} stron bez użytecznego og:image`,
    );
    return null;
  } catch (err) {
    note(`og-image: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function hashImageBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh, non-generic Uint8Array — TS's BufferSource type
  // rejects the ArrayBufferLike-backed view DocImage.bytes can carry.
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Znajduje jedno zdjęcie: Google CSE (jeśli skonfigurowane), Wikipedia,
 *  darmowe wyszukanie og:image w całej sieci, na końcu Openverse CC — w tej
 *  kolejności.
 *
 *  ŚCIEŻKI GENEROWANIA PRZEZ MODEL JUŻ NIE MA. Obraz z modelu graficznego
 *  bywał rozjeżdżoną atrapą tematu, kosztował płatne żądanie na kluczu
 *  użytkownika i regularnie wracał jako 503 — a przy tym nie miał adresu
 *  źródłowego, więc był jedynym powodem, dla którego podgląd nie mógł
 *  pokazać wszystkich obrazów. Zdjęcia z sieci rozwiązują wszystkie trzy
 *  rzeczy naraz.
 *
 *  `usedHashes` dedupes ACROSS the whole document: querying different facets
 *  of the same broad subject (e.g. "GTA VI characters" vs "GTA VI gameplay")
 *  very often resolves to the SAME Wikipedia article — and thus the same
 *  single infobox image — for both. Live failure (2026-08-16): a 5-slide
 *  GTA VI deck showed the identical cover art on every single slide. When a
 *  tier's hit hashes to an image already claimed elsewhere in this document,
 *  it's treated as a miss and the next tier is tried instead, so a repeat
 *  never gets embedded twice. */
async function resolveOneImage(
  job: { imageQuery?: string },
  apiKey: string,
  usedHashes: Set<string>,
  note: Note,
  googleCse?: GoogleCseCreds,
): Promise<DocImage | null> {
  const claim = async (candidate: DocImage | null, tier: string): Promise<DocImage | null> => {
    if (!candidate) return null;
    const hash = await hashImageBytes(candidate.bytes);
    if (usedHashes.has(hash)) {
      note(`${tier}: to samo zdjęcie już użyte w tym dokumencie`);
      return null; // duplicate — let the caller try the next tier
    }
    usedHashes.add(hash);
    return candidate;
  };

  if (!job.imageQuery) return null;

  if (googleCse) {
    const cse = await claim(await fetchGoogleCseImage(job.imageQuery, googleCse, note), "cse");
    if (cse) return cse;
  } else {
    note("cse: pominięte (brak klucza)");
  }

  // NAJPIERW ANGIELSKA, POTEM POLSKA WIKIPEDIA. Opis obrazu ma być po
  // angielsku (tak brzmi instrukcja narzędzia), ale w dokumencie pisanym po
  // polsku model regularnie zjeżdża na polski mimo niej — a wtedy i
  // angielska Wikipedia, i Openverse, oba indeksowane po angielsku, zwracają
  // pustkę. Jedno dodatkowe zapytanie ratuje cały ten przypadek; przy
  // zapytaniu angielskim druga próba i tak zwykle nie dochodzi do skutku,
  // bo pierwsza trafia.
  const wikiEn = await claim(await fetchWikipediaImage(job.imageQuery, "en", note), "wikipedia:en");
  if (wikiEn) return wikiEn;
  const wikiPl = await claim(await fetchWikipediaImage(job.imageQuery, "pl", note), "wikipedia:pl");
  if (wikiPl) return wikiPl;

  const webPhoto = await claim(
    await fetchWebSearchOgImage(job.imageQuery, apiKey, note),
    "og-image",
  );
  if (webPhoto) return webPhoto;

  const photo = await claim(await fetchWebImage(job.imageQuery, note), "openverse");
  if (photo) return photo;

  return null;
}

/** Znajduje zdjęcie tytułowe i zdjęcia bloków zadeklarowane w opisie.
 *  Best-effort: any individual failure just means that slide
 *  renders text-only — never fails the whole document. Resolved SEQUENTIALLY
 *  (not in parallel): cross-document deduplication (see resolveOneImage)
 *  needs each job to see what every earlier job already claimed, which a
 *  parallel Promise.all can't provide without races. Slower wall-clock, but
 *  correctness (no repeated image) matters more than shaving a few seconds
 *  off a background job. */
export async function generateDocImages(
  spec: ProducerSpec,
  apiKey: string,
  onWarn?: (message: string) => Promise<void> | void,
  googleCse?: GoogleCseCreds,
): Promise<DocImages> {
  type Job = { key: "hero" | number; imageQuery: string };
  const jobs: Job[] = [];
  if (spec.heroImageQuery) jobs.push({ key: "hero", imageQuery: spec.heroImageQuery });
  for (const [i, section] of blocksOf(spec).entries()) {
    if (section.imageQuery) jobs.push({ key: i, imageQuery: section.imageQuery });
  }
  const capped = jobs.slice(0, 1 + MAX_SECTION_IMAGES);

  const images: DocImages = { sections: new Map() };
  if (capped.length === 0) return images;

  const usedHashes = new Set<string>();
  for (const job of capped) {
    // Notatki z warstw zbierane per zadanie. To one zamieniają meldunek
    // „nie znalazłem" w meldunek, z którego wiadomo, co robić dalej.
    const notes: string[] = [];
    try {
      const result = await resolveOneImage(
        job,
        apiKey,
        usedHashes,
        (text) => notes.push(text),
        googleCse,
      );
      if (result) {
        if (job.key === "hero") images.hero = result;
        else images.sections.set(job.key, result);
      } else {
        await onWarn?.(
          `image resolution failed (${String(job.key)}) „${job.imageQuery}": ` +
            (notes.length > 0 ? notes.join(" | ") : "no image resolved"),
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onWarn?.(
        `image resolution failed (${String(job.key)}) „${job.imageQuery}": ${reason}` +
          (notes.length > 0 ? ` | ${notes.join(" | ")}` : ""),
      );
    }
  }
  return images;
}

const NO_IMAGES: DocImages = { sections: new Map() };

const toDataUri = (img: DocImage): string => {
  let binary = "";
  for (const b of img.bytes) binary += String.fromCharCode(b);
  return `${img.mime};base64,${btoa(binary)}`;
};

/** PNG pixel dimensions from the IHDR chunk; null for non-PNG/garbage. */
export function pngDims(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ---------------------------------------------------------------------------
// pptx — pptxgenjs
// ---------------------------------------------------------------------------

// Kolory czytane z motywu — ten sam zestaw, z którego korzysta renderer docx
// i podgląd slajdów w przeglądarce. Tutaj zostają wyłącznie aliasy, żeby
// współrzędne poniżej dało się czytać bez rozpraszania.
const { accent: ACCENT_HEX, dark: DARK_HEX, body: BODY_HEX } = DOC_COLORS;
const { surface: SURFACE_HEX, muted: MUTED_HEX, paper: PAPER_HEX } = DOC_COLORS;
const SURFACE_LIGHT = DOC_COLORS.paper;

async function buildPptx(spec: DeckSpec, images: DocImages): Promise<Uint8Array> {
  // Gdyby pakowanie wymyśliło jeszcze trzecią postać eksportu, niech powie
  // to wprost. „PptxGen is not a constructor" nie wskazuje ani biblioteki,
  // ani przyczyny i kosztowało pełne śledztwo od strony użytkownika.
  if (typeof PptxGenClass !== "function") {
    // Gdyby pakowanie wymyśliło JESZCZE INNĄ postać eksportu, niech powie to
    // wprost i z zawartością. „PptxGen is not a constructor" nie wskazuje ani
    // biblioteki, ani przyczyny — i kosztowało pełne śledztwo od strony
    // użytkownika. Nazwy pól wystarczą, żeby następnym razem poprawka poszła
    // od razu w odpowiednie miejsce.
    const shape =
      PptxGenClass && typeof PptxGenClass === "object"
        ? Object.keys(PptxGenClass).slice(0, 10).join(", ") || "obiekt bez pól"
        : String(PptxGenClass);
    throw new Error(
      `pptxgenjs: domyślny eksport nie jest klasą (zgodność ESM/CJS w pakowaniu). ` +
        `typeof=${typeof PptxGenClass}, zawartość: ${shape}`,
    );
  }
  const pres = new PptxGenClass();
  pres.defineLayout({ name: "WIDE", ...DECK_SLIDE });
  // Kroje ustawiane raz, na poziomie prezentacji — zamiast powtarzać
  // `fontFace` przy każdym polu tekstowym i prędzej czy później gdzieś go
  // zapomnieć.
  pres.theme = { headFontFace: DOC_FONTS.heading, bodyFontFace: DOC_FONTS.body };
  pres.layout = "WIDE";

  // Title slide — dark; with a hero image the right half becomes a
  // full-bleed visual with a soft dark scrim so the accent bar + title
  // always stay readable on the left.
  const title = pres.addSlide();
  title.background = { color: DARK_HEX };
  const hasHero = !!images.hero;
  if (images.hero) {
    title.addImage({
      data: toDataUri(images.hero),
      x: 6.4,
      y: 0,
      w: 6.93,
      h: 7.5,
      sizing: { type: "cover", w: 6.93, h: 7.5 },
    });
    title.addShape("rect", {
      x: 6.4,
      y: 0,
      w: 6.93,
      h: 7.5,
      fill: { color: DARK_HEX, transparency: 62 },
    });
  }
  const titleWidth = hasHero ? 5.2 : 11.6;
  title.addShape("rect", { x: 0.9, y: 3.62, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  title.addText(spec.title, {
    x: 0.85,
    y: 1.9,
    w: titleWidth,
    h: 1.6,
    fontSize: hasHero ? 34 : 40,
    bold: true,
    color: "F8FAFC",
    valign: "bottom",
  });
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.85,
      y: 3.85,
      w: titleWidth,
      h: 0.9,
      fontSize: 18,
      color: MUTED_HEX,
      valign: "top",
    });
  }
  // Cover metadata line (section count) — the kind of small, quiet detail
  // that makes a report cover read as designed rather than a bare title.
  // +2 = slajd tytułowy i końcowy. Wcześniej okładka mówiła „13 SLAJDÓW",
  // stopki „x/14", a PowerPoint pokazywał 15 — trzy różne liczby na jeden
  // plik, z których żadna nie była prawdziwa.
  title.addText(`${spec.slides.length + 2} SLAJDÓW`, {
    x: 0.85,
    y: 6.85,
    w: 4,
    h: 0.4,
    fontSize: 11,
    color: MUTED_HEX,
    charSpacing: 2,
  });

  const totalSlides = spec.slides.length + 2; // tytułowy + treść + końcowy
  for (const [i, slideSpec] of spec.slides.entries()) {
    const ctx: SlideCtx = {
      slide: pres.addSlide(),
      spec: slideSpec,
      image: images.sections.get(i),
      index: i,
      total: totalSlides,
      deckTitle: spec.title,
    };
    // Dyspozytor układów. Normalizacja gwarantuje, że dane wymagane przez
    // dany układ są na miejscu (patrz resolveLayout w docSpec.ts), więc
    // żaden renderer poniżej nie sprawdza tego drugi raz.
    switch (slideSpec.layout) {
      case "section":
        renderSectionBreak(ctx);
        break;
      case "statement":
        renderStatement(ctx);
        break;
      case "metrics":
        renderMetrics(ctx);
        break;
      case "compare":
        renderCompare(ctx);
        break;
      case "photo":
        renderPhoto(ctx);
        break;
      default:
        renderBullets(ctx);
    }
  }

  // Closing card — bookends the dark title slide instead of ending abruptly
  // on the last content slide, the way a real report has a back cover.
  const closing = pres.addSlide();
  closing.background = { color: DARK_HEX };
  closing.addShape("rect", { x: 0.9, y: 3.62, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  closing.addText(spec.title, {
    x: 0.85,
    y: 2.9,
    w: 11.6,
    h: 0.7,
    fontSize: 22,
    bold: true,
    color: "F8FAFC",
  });
  closing.addText("KONIEC PREZENTACJI", {
    x: 0.85,
    y: 3.75,
    w: 11.6,
    h: 0.4,
    fontSize: 12,
    color: MUTED_HEX,
    charSpacing: 2,
  });

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Biblioteka układów slajdów
// ---------------------------------------------------------------------------
//
// Jeden układ = jedna funkcja, jeden komplet współrzędnych, zero wspólnego
// kodu pozycjonowania między nimi. To jest celowe: układy nie dziedziczą po
// sobie, bo „prawie taki sam jak tamten, tylko…" jest dokładnie tym, z czego
// bierze się kod, którego nikt później nie rusza ze strachu.
//
// Wszystkie liczby są w calach na płótnie 13.33 × 7.5 (16:9). Margines
// roboczy to 0.85 z lewej i 12.45 z prawej — trzymanie go daje prezentacji
// wspólny rytm bez żadnego mechanizmu, który by go pilnował.

type SlideCtx = {
  slide: PptxGen.Slide;
  spec: DeckSlide;
  image?: DocImage;
  index: number;
  total: number;
  deckTitle: string;
};

const MARGIN_X = 0.85;
const CONTENT_W = 11.6;

/** Tytuł prezentacji + numer slajdu w prawym górnym rogu. Na ciemnych
 *  układach pomijany — tam chrom konkuruje z treścią zamiast jej służyć. */
function addChrome(ctx: SlideCtx): void {
  ctx.slide.addText(
    `${ctx.deckTitle.toUpperCase()}  ·  ${String(ctx.index + 2).padStart(2, "0")}/${String(
      ctx.total,
    ).padStart(2, "0")}`,
    {
      x: 6.45,
      y: 0.35,
      w: 6,
      h: 0.3,
      fontSize: 9,
      color: MUTED_HEX,
      align: "right",
      charSpacing: 1,
    },
  );
}

/** Lewy pasek akcentu — wspólna sygnatura jasnych slajdów. */
function addSpine(ctx: SlideCtx): void {
  ctx.slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT_HEX } });
}

function addHeading(ctx: SlideCtx, y: number, w = CONTENT_W): void {
  ctx.slide.addText(ctx.spec.heading, {
    x: MARGIN_X,
    y,
    w,
    h: 0.9,
    fontSize: 26,
    bold: true,
    color: DARK_HEX,
    valign: "bottom",
  });
}

/** Punkty i akapit — koń roboczy, jedyny układ ze zdjęciem z boku. */
function renderBullets(ctx: SlideCtx): void {
  const { slide, spec, image, index } = ctx;
  slide.background = { color: SURFACE_LIGHT };
  addSpine(ctx);
  addChrome(ctx);

  // Zdjęcie raz z lewej, raz z prawej. Prezentacja, w której każdy obraz
  // ląduje w tym samym miejscu, czyta się jak odbitka z szablonu — a
  // przemienność nie kosztuje ani jednego dodatkowego układu.
  const imageOnLeft = !!image && index % 2 === 1;
  const imageX = imageOnLeft ? 0.75 : 8.15;
  const textX = imageOnLeft ? 5.9 : MARGIN_X;
  const bodyWidth = image ? 6.5 : CONTENT_W;

  slide.addShape("rect", { x: textX, y: 0.62, w: 1.1, h: 0.07, fill: { color: ACCENT_HEX } });
  slide.addText(spec.heading, {
    x: textX,
    y: 0.85,
    w: bodyWidth,
    h: 1.1,
    fontSize: 26,
    bold: true,
    color: DARK_HEX,
    valign: "bottom",
  });

  if (image) {
    slide.addShape("rect", { x: imageX, y: 1.45, w: 4.43, h: 4.9, fill: { color: SURFACE_HEX } });
    slide.addImage({
      data: toDataUri(image),
      x: imageX,
      y: 1.45,
      w: 4.43,
      h: 4.9,
      sizing: { type: "cover", w: 4.43, h: 4.9 },
    });
    slide.addShape("rect", { x: imageX, y: 6.38, w: 4.43, h: 0.06, fill: { color: ACCENT_HEX } });
  }

  const body: PptxGen.TextProps[] = [];
  if (spec.content) body.push({ text: spec.content, options: { fontSize: 15, color: BODY_HEX } });
  for (const bullet of spec.bullets ?? []) {
    body.push({
      text: bullet,
      options: {
        fontSize: 15,
        color: BODY_HEX,
        bullet: { code: "2022", indent: 14 },
        paraSpaceBefore: 6,
      },
    });
  }
  if (body.length > 0) {
    slide.addText(body, { x: textX, y: 2.15, w: bodyWidth, h: 4.6, valign: "top" });
  }
}

/** Przekładka: wielki numer i tytuł części na ciemnym tle. */
function renderSectionBreak(ctx: SlideCtx): void {
  const { slide, spec, index } = ctx;
  slide.background = { color: DARK_HEX };
  slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT_HEX } });
  slide.addText(String(index + 1).padStart(2, "0"), {
    x: MARGIN_X,
    y: 1.7,
    w: 3,
    h: 2,
    fontSize: 96,
    bold: true,
    color: ACCENT_HEX,
    valign: "bottom",
  });
  slide.addShape("rect", { x: MARGIN_X, y: 3.95, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  slide.addText(spec.heading, {
    x: MARGIN_X,
    y: 4.2,
    w: CONTENT_W,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: PAPER_HEX,
    valign: "top",
  });
  if (spec.content) {
    slide.addText(spec.content, {
      x: MARGIN_X,
      y: 5.45,
      w: 9,
      h: 1.2,
      fontSize: 15,
      color: MUTED_HEX,
      valign: "top",
    });
  }
}

/** Jedna teza dużym krojem. Nagłówek schodzi do roli etykiety nad nią. */
function renderStatement(ctx: SlideCtx): void {
  const { slide, spec } = ctx;
  slide.background = { color: SURFACE_LIGHT };
  addSpine(ctx);
  addChrome(ctx);

  const text = spec.content || (spec.bullets ?? []).join("  ·  ");
  slide.addText(spec.heading.toUpperCase(), {
    x: MARGIN_X,
    y: 1.9,
    w: CONTENT_W,
    h: 0.4,
    fontSize: 11,
    color: MUTED_HEX,
    charSpacing: 2,
  });
  slide.addShape("rect", { x: MARGIN_X, y: 2.45, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  slide.addText(text, {
    x: MARGIN_X,
    y: 2.8,
    w: CONTENT_W,
    h: 2.6,
    fontSize: 30,
    bold: true,
    color: DARK_HEX,
    valign: "top",
  });
}

/** Od jednej do czterech liczb w rzędzie, każda z podpisem. */
function renderMetrics(ctx: SlideCtx): void {
  const { slide, spec } = ctx;
  const metrics = spec.metrics ?? [];
  slide.background = { color: SURFACE_LIGHT };
  addSpine(ctx);
  addChrome(ctx);
  slide.addShape("rect", { x: MARGIN_X, y: 0.62, w: 1.1, h: 0.07, fill: { color: ACCENT_HEX } });
  addHeading(ctx, 0.85);

  const gap = 0.3;
  const cellW = (CONTENT_W - gap * (metrics.length - 1)) / metrics.length;
  // Liczba zwęża się wraz z liczbą kafli — cztery wartości po 66pt zlałyby
  // się w jeden pas. Skok jest w krokach, nie proporcjonalny, bo cyfry i tak
  // nie skalują się liniowo do czytelności.
  const valueSize = metrics.length >= 4 ? 44 : metrics.length === 3 ? 54 : 66;
  for (const [i, metric] of metrics.entries()) {
    const x = MARGIN_X + i * (cellW + gap);
    slide.addShape("rect", { x, y: 2.5, w: cellW, h: 0.07, fill: { color: ACCENT_HEX } });
    slide.addText(metric.value, {
      x,
      y: 2.75,
      w: cellW,
      h: 1.5,
      fontSize: valueSize,
      bold: true,
      color: ACCENT_HEX,
      valign: "top",
    });
    if (metric.label) {
      slide.addText(metric.label, {
        x,
        y: 4.4,
        w: cellW,
        h: 1.4,
        fontSize: 13,
        color: BODY_HEX,
        valign: "top",
      });
    }
  }

  if (spec.content) {
    slide.addText(spec.content, {
      x: MARGIN_X,
      y: 6.1,
      w: CONTENT_W,
      h: 0.9,
      fontSize: 13,
      color: MUTED_HEX,
      valign: "top",
    });
  }
}

/** Dwie kolumny obok siebie — zestawienie. */
function renderCompare(ctx: SlideCtx): void {
  const { slide, spec } = ctx;
  const columns = spec.columns ?? [];
  slide.background = { color: SURFACE_LIGHT };
  addSpine(ctx);
  addChrome(ctx);
  slide.addShape("rect", { x: MARGIN_X, y: 0.62, w: 1.1, h: 0.07, fill: { color: ACCENT_HEX } });
  addHeading(ctx, 0.85);

  const colW = 5.5;
  for (const [i, column] of columns.entries()) {
    const x = MARGIN_X + i * (colW + 0.6);
    slide.addShape("rect", { x, y: 2.25, w: colW, h: 0.62, fill: { color: SURFACE_HEX } });
    slide.addShape("rect", { x, y: 2.25, w: 0.08, h: 0.62, fill: { color: ACCENT_HEX } });
    slide.addText(column.heading, {
      x: x + 0.25,
      y: 2.25,
      w: colW - 0.4,
      h: 0.62,
      fontSize: 15,
      bold: true,
      color: DARK_HEX,
      valign: "middle",
    });
    if (column.bullets.length > 0) {
      slide.addText(
        column.bullets.map((b) => ({
          text: b,
          options: {
            fontSize: 13,
            color: BODY_HEX,
            bullet: { code: "2022", indent: 14 },
            paraSpaceBefore: 6,
          },
        })),
        { x, y: 3.1, w: colW, h: 3.7, valign: "top" },
      );
    }
  }
}

/** Zdjęcie na pełnym slajdzie, tytuł na przyciemnieniu u dołu. */
function renderPhoto(ctx: SlideCtx): void {
  const { slide, spec, image } = ctx;
  slide.background = { color: DARK_HEX };
  if (image) {
    slide.addImage({
      data: toDataUri(image),
      x: 0,
      y: 0,
      w: 13.33,
      h: 7.5,
      sizing: { type: "cover", w: 13.33, h: 7.5 },
    });
  }
  // Przyciemnienie tylko pod tekstem, nie na całym kadrze: zdjęcie ma
  // zostać zdjęciem, a nie tłem przykrytym szarą płachtą.
  slide.addShape("rect", {
    x: 0,
    y: 4.9,
    w: 13.33,
    h: 2.6,
    fill: { color: DARK_HEX, transparency: 20 },
  });
  slide.addShape("rect", { x: MARGIN_X, y: 5.35, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  slide.addText(spec.heading, {
    x: MARGIN_X,
    y: 5.6,
    w: CONTENT_W,
    h: 1.1,
    fontSize: 30,
    bold: true,
    color: PAPER_HEX,
    valign: "top",
  });
}

// ---------------------------------------------------------------------------
// docx — docx
// ---------------------------------------------------------------------------

async function buildDocx(spec: DocSpec, images: DocImages): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: spec.title, bold: true })],
    }),
  ];
  if (spec.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: spec.subtitle, italics: true, color: "64748B" })],
      }),
    );
  }
  if (images.hero) {
    // Full-width hero banner under the title. Word needs explicit pixel
    // dimensions; read them from the PNG header when possible, otherwise
    // assume the 16:9 we requested from the image model.
    const dims = pngDims(images.hero.bytes);
    const width = 624;
    const height = dims ? Math.round((width * dims.height) / dims.width) : 351;
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new ImageRun({
            data: images.hero.bytes,
            type: images.hero.mime === "image/jpeg" ? "jpg" : "png",
            transformation: { width, height },
          }),
        ],
      }),
    );
  }

  for (const section of spec.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        children: [new TextRun({ text: section.heading })],
      }),
    );
    if (section.content) {
      for (const para of section.content.split(/\n{2,}/)) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: para.replace(/\n/g, " ") })],
          }),
        );
      }
    }
    for (const bullet of section.bullets ?? []) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: bullet })],
        }),
      );
    }
  }

  const doc = new Document({
    creator: "J.A.R.V.I.S. F.O.R.G.E.",
    title: spec.title,
    // Kroje z motywu, ustawione na stylu domyślnym — dokument ma czytać się
    // jak plik z tego samego systemu co prezentacja, a nie jak Calibri
    // z pustego szablonu Worda.
    styles: {
      default: {
        document: { run: { font: DOC_FONTS.body, color: DOC_COLORS.body } },
        title: { run: { font: DOC_FONTS.heading, color: DOC_COLORS.dark } },
        heading1: { run: { font: DOC_FONTS.heading, color: DOC_COLORS.dark } },
        heading2: { run: { font: DOC_FONTS.heading, color: DOC_COLORS.dark } },
      },
    },
    sections: [{ children }],
  });
  // toArrayBuffer, not toBuffer — the deployed server runtime is not
  // guaranteed to have Node's Buffer (nitro's default target here is
  // cloudflare), and the ArrayBuffer path works everywhere.
  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}

export async function buildDocument(
  spec: ProducerSpec,
  images: DocImages = NO_IMAGES,
): Promise<Uint8Array> {
  return spec.format === "pptx" ? buildPptx(spec, images) : buildDocx(spec, images);
}
