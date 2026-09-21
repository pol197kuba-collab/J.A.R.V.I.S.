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
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { DEFAULT_GEMINI_IMAGE_MODEL, DEFAULT_GEMINI_MODEL } from "./models";
import { DOC_COLORS, DOC_FONTS, DECK_SLIDE } from "./docTheme";
import {
  blocksOf,
  MAX_SECTION_IMAGES,
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

export type DocImage = { bytes: Uint8Array; mime: string };
export type DocImages = { hero?: DocImage; sections: Map<number, DocImage> };

// One consistent visual language across every generated deck, so slides read
// as a designed set rather than random stock art. "No text" is load-bearing:
// image models render garbled words otherwise.
const IMAGE_STYLE_PREFIX =
  "Premium technology presentation illustration, dark navy and cyan color palette, " +
  "cinematic lighting, sleek modern aesthetic, high detail. Strictly no text, no words, " +
  "no letters, no captions, no watermarks. ";

// The image model (gemini-2.5-flash-image, preview) is heavily
// shared-capacity and returns HTTP 503 "high demand" / 500 "internal error"
// in bursts far more often than the text model — observed live 2026-07-22:
// five presentation runs in a row all came back with 0 images while the deck
// itself generated fine. A single shot reliably loses that race, so retry on
// transient statuses with short backoff. Kept separate from the orchestrator
// retry (different endpoint, tighter per-attempt timeout) but same idea.
const IMAGE_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// 3 attempts total. Worst case 3×12s + backoff stays inside the
// server-function budget (a producer run has been observed at ~41s), while
// giving three shots at hitting an available window during a 503 burst —
// each 503 fails fast (<1s), so the retries are cheap unless the model
// actually hangs.
const IMAGE_MAX_RETRIES = 2;
const IMAGE_RETRY_BACKOFF_MS = 500;
const IMAGE_ATTEMPT_TIMEOUT_MS = 12_000;

async function generateOneImage(
  prompt: string,
  apiKey: string,
  timeoutMs: number,
): Promise<DocImage | null> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= IMAGE_MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          DEFAULT_GEMINI_IMAGE_MODEL,
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: IMAGE_STYLE_PREFIX + prompt }] }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { aspectRatio: "16:9" },
            },
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Retry transient overload; give up immediately on anything else
        // (bad request, auth) — retrying won't help there.
        if (IMAGE_RETRYABLE_STATUS.has(res.status) && attempt < IMAGE_MAX_RETRIES) {
          lastErr = new Error(`HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, IMAGE_RETRY_BACKOFF_MS * (attempt + 1)));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
        }>;
      };
      const inline = (data.candidates?.[0]?.content?.parts ?? []).find((p) =>
        p.inlineData?.mimeType?.startsWith("image/"),
      )?.inlineData;
      if (!inline?.data) return null;
      return {
        bytes: Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0)),
        mime: inline.mimeType ?? "image/png",
      };
    } catch (err) {
      // AbortError (timeout) is worth one more try too, up to the cap.
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < IMAGE_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, IMAGE_RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("image generation failed");
}

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

async function fetchWebImage(query: string): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const searchUrl =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
      `&license_type=all&mature=false&page_size=3`;
    const res = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "JARVIS-Forge/1.0" },
    });
    if (!res.ok) throw new Error(`openverse HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ url?: string; filetype?: string }>;
    };
    for (const hit of data.results ?? []) {
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
          headers: { "User-Agent": "JARVIS-Forge/1.0" },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0] };
      } catch {
        continue; // try the next candidate
      }
    }
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
async function fetchWikipediaImage(query: string): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&list=search&srlimit=1&srsearch=${encodeURIComponent(query)}`;
    const searchRes = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "JARVIS-Forge/1.0" },
    });
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      query?: { search?: Array<{ title?: string }> };
    };
    const title = searchData.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        signal: ctrl.signal,
        headers: { "User-Agent": "JARVIS-Forge/1.0", Accept: "application/json" },
      },
    );
    if (!summaryRes.ok) return null;
    const summary = (await summaryRes.json()) as {
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
    };
    const imageUrl = summary.originalimage?.source ?? summary.thumbnail?.source;
    if (!imageUrl || !/^https:\/\/upload\.wikimedia\.org\//i.test(imageUrl)) return null;

    const imgRes = await fetch(imageUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "JARVIS-Forge/1.0" },
    });
    if (!imgRes.ok) return null;
    const mime = imgRes.headers.get("content-type") ?? "";
    if (!mime.startsWith("image/")) return null;
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) return null;
    return { bytes: buf, mime: mime.split(";")[0] };
  } catch {
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
async function fetchGoogleCseImage(query: string, creds: GoogleCseCreds): Promise<DocImage | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_IMAGE_TIMEOUT_MS);
  try {
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(creds.apiKey)}` +
      `&cx=${encodeURIComponent(creds.cx)}&q=${encodeURIComponent(query)}` +
      `&searchType=image&num=3&safe=active`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ link?: string }> };
    for (const item of data.items ?? []) {
      const link = item.link;
      if (!link || !/^https:\/\//i.test(link)) continue;
      try {
        const imgRes = await fetch(link, {
          signal: ctrl.signal,
          headers: { "User-Agent": "JARVIS-Forge/1.0" },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0] };
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{
        groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
      }>;
    };
    const urls = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .flatMap((c) => (c.web?.uri ? [c.web.uri] : []))
      .slice(0, 4);

    for (const pageUrl of urls) {
      try {
        const pageRes = await fetch(pageUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-Forge/1.0)" },
        });
        if (!pageRes.ok) continue;
        const contentType = pageRes.headers.get("content-type") ?? "";
        if (!contentType.includes("html")) continue;
        // Only the <head> realistically needs reading for a meta tag — caps
        // download size for pages that don't stream-truncate cleanly.
        const html = (await pageRes.text()).slice(0, 60_000);
        const match = OG_IMAGE_TAG_RE.exec(html);
        const imageUrl = match?.[1];
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) continue;

        const imgRes = await fetch(imageUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": "JARVIS-Forge/1.0" },
        });
        if (!imgRes.ok) continue;
        const mime = imgRes.headers.get("content-type") ?? "";
        if (!mime.startsWith("image/")) continue;
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_WEB_IMAGE_BYTES) continue;
        return { bytes: buf, mime: mime.split(";")[0] };
      } catch {
        continue; // try the next candidate page
      }
    }
    return null;
  } catch {
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

/** Resolve one slide image: a real photo — tried Google CSE (if configured),
 *  Wikipedia, a free whole-web og:image lookup, then Openverse CC, in that
 *  order — if imageQuery was requested, otherwise an AI-generated one
 *  (imagePrompt). Real photos are preferred and don't touch the AI image
 *  model at all.
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
  job: { imageQuery?: string; imagePrompt?: string },
  apiKey: string,
  usedHashes: Set<string>,
  googleCse?: GoogleCseCreds,
): Promise<DocImage | null> {
  const claim = async (candidate: DocImage | null): Promise<DocImage | null> => {
    if (!candidate) return null;
    const hash = await hashImageBytes(candidate.bytes);
    if (usedHashes.has(hash)) return null; // duplicate — let the caller try the next tier
    usedHashes.add(hash);
    return candidate;
  };

  if (job.imageQuery) {
    if (googleCse) {
      const cse = await claim(await fetchGoogleCseImage(job.imageQuery, googleCse));
      if (cse) return cse;
    }
    const wiki = await claim(await fetchWikipediaImage(job.imageQuery));
    if (wiki) return wiki;
    const webPhoto = await claim(await fetchWebSearchOgImage(job.imageQuery, apiKey));
    if (webPhoto) return webPhoto;
    const photo = await claim(await fetchWebImage(job.imageQuery));
    if (photo) return photo;
    // Fall back to AI generation only if a prompt was also supplied.
  }
  if (job.imagePrompt) return generateOneImage(job.imagePrompt, apiKey, IMAGE_ATTEMPT_TIMEOUT_MS);
  return null;
}

/** Resolve the hero + section images declared in the spec (web photos and/or
 *  AI graphics). Best-effort: any individual failure just means that slide
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
  type Job = { key: "hero" | number; imageQuery?: string; imagePrompt?: string };
  const jobs: Job[] = [];
  if (spec.heroImageQuery || spec.heroImagePrompt) {
    jobs.push({ key: "hero", imageQuery: spec.heroImageQuery, imagePrompt: spec.heroImagePrompt });
  }
  for (const [i, section] of blocksOf(spec).entries()) {
    if (section.imageQuery || section.imagePrompt) {
      jobs.push({ key: i, imageQuery: section.imageQuery, imagePrompt: section.imagePrompt });
    }
  }
  const capped = jobs.slice(0, 1 + MAX_SECTION_IMAGES);

  const images: DocImages = { sections: new Map() };
  if (capped.length === 0) return images;

  const usedHashes = new Set<string>();
  for (const job of capped) {
    try {
      const result = await resolveOneImage(job, apiKey, usedHashes, googleCse);
      if (result) {
        if (job.key === "hero") images.hero = result;
        else images.sections.set(job.key, result);
      } else {
        await onWarn?.(`image resolution failed (${String(job.key)}): no image resolved`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onWarn?.(`image resolution failed (${String(job.key)}): ${reason}`);
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
const { surface: SURFACE_HEX, muted: MUTED_HEX } = DOC_COLORS;

async function buildPptx(spec: DeckSpec, images: DocImages): Promise<Uint8Array> {
  const pres = new PptxGen();
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
  title.addText(`${spec.slides.length} SLAJDÓW`, {
    x: 0.85,
    y: 6.85,
    w: 4,
    h: 0.4,
    fontSize: 11,
    color: MUTED_HEX,
    charSpacing: 2,
  });

  const totalSlides = spec.slides.length + 1; // +1 na sam slajd tytułowy
  for (const [i, section] of spec.slides.entries()) {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT_HEX } });

    const sectionImage = images.sections.get(i);
    // Alternate which side the photo sits on, slide to slide — a deck where
    // every single image lands in the identical spot reads as a template
    // stamped out by code (which, structurally, it is); alternating is the
    // cheapest way to break that pattern without inventing new layouts.
    const imageOnLeft = sectionImage ? i % 2 === 1 : false;
    const imageX = imageOnLeft ? 0.75 : 8.15;
    const textX = imageOnLeft ? 5.9 : 0.8;
    // Badge sits at 5.9 in the imageOnLeft case (see badgeX below) — offset
    // the heading past it by the same 0.85" gap the imageOnLeft=false case
    // uses (badgeX 0.75 → headingX 1.6), instead of the two colliding.
    const headingX = imageOnLeft ? 6.75 : 1.6;

    // Header chrome: deck title (kicker) + running page count, tucked into
    // whichever top corner sits ABOVE the photo — the one guaranteed-empty
    // strip regardless of layout. With no image the heading runs nearly
    // full-width, so there's no safe corner left for chrome — skip it there
    // rather than risk it colliding with the heading text.
    if (sectionImage) {
      const chromeX = imageOnLeft ? imageX : 8.5;
      const chromeAlign: "left" | "right" = imageOnLeft ? "left" : "right";
      slide.addText(spec.title.toUpperCase(), {
        x: chromeX,
        y: 0.35,
        w: 4.05,
        h: 0.3,
        fontSize: 9,
        color: MUTED_HEX,
        align: chromeAlign,
        charSpacing: 1,
      });
      slide.addText(`${String(i + 2).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`, {
        x: chromeX,
        y: 0.65,
        w: 4.05,
        h: 0.3,
        fontSize: 9,
        color: MUTED_HEX,
        align: chromeAlign,
      });
    }

    // Number badge — filled accent square with the slide number, anchoring
    // the heading instead of a lone footer digit.
    const badgeX = imageOnLeft ? 5.9 : 0.75;
    slide.addShape("rect", { x: badgeX, y: 0.55, w: 0.62, h: 0.62, fill: { color: ACCENT_HEX } });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: badgeX,
      y: 0.55,
      w: 0.62,
      h: 0.62,
      fontSize: 16,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });
    slide.addText(section.heading, {
      x: headingX,
      y: 0.45,
      w: sectionImage ? 6.4 : 11.0,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: DARK_HEX,
      valign: "middle",
    });

    if (sectionImage) {
      // Matted panel: a soft light-grey field slightly larger than the
      // photo itself (like a print mat around a framed picture), plus thin
      // accent keylines top and bottom — reads as a deliberately framed
      // photo rather than an image slapped onto bare white.
      slide.addShape("rect", {
        x: imageX - 0.2,
        y: 1.35,
        w: 4.83,
        h: 5.4,
        fill: { color: SURFACE_HEX },
      });
      slide.addImage({
        data: toDataUri(sectionImage),
        x: imageX,
        y: 1.55,
        w: 4.43,
        h: 5.0,
        sizing: { type: "cover", w: 4.43, h: 5.0 },
      });
      slide.addShape("rect", { x: imageX, y: 1.49, w: 4.43, h: 0.06, fill: { color: ACCENT_HEX } });
      slide.addShape("rect", { x: imageX, y: 6.62, w: 4.43, h: 0.06, fill: { color: ACCENT_HEX } });
    }

    const bodyWidth = sectionImage ? 6.9 : 11.7;
    const body: PptxGen.TextProps[] = [];
    if (section.content) {
      body.push({ text: section.content, options: { fontSize: 16, color: BODY_HEX } });
    }
    for (const bullet of section.bullets ?? []) {
      body.push({
        text: bullet,
        options: {
          fontSize: 16,
          color: BODY_HEX,
          bullet: { code: "2022", indent: 14 },
          paraSpaceBefore: 6,
        },
      });
    }
    if (body.length > 0) {
      slide.addText(body, { x: textX, y: 1.55, w: bodyWidth, h: 5.4, valign: "top" });
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
