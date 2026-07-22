// Producer agent — document builders (pptx / docx / pdf).
//
// Pure functions from a normalized DocSpec to file bytes, kept separate from
// the tool wiring in tools.server.ts so they're unit-testable without a
// Supabase context. All three formats are pure-JS (pptxgenjs, docx, pdf-lib)
// per the repo's TypeScript-first rule — no native dependencies, runnable in
// the existing server-function runtime.
//
// PDF is the only format that needs an embedded font: pdf-lib's built-in
// StandardFonts are WinAnsi-encoded and throw on the first Polish diacritic,
// so a subsetted Unicode TTF (producerFonts.server.ts) is embedded via
// fontkit instead. pptx/docx only reference font names — the viewer supplies
// the actual glyphs, so they need none of this.

import PptxGen from "pptxgenjs";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
// Deliberately the fully-bundled dist, NOT the bare "pdf-lib" entry. The
// default multi-file es/ build imports bare `tslib` (v1 — no `exports` map,
// UMD with dynamically-generated exports the SSR bundler's CJS interop can't
// statically analyze), which crashed in the deployed bundle with "Cannot
// destructure property '__extends' of '__toESM(...).default'" on every
// generate_document call — while working fine in local node/vitest. The
// dist bundle has tslib (and all other deps) inlined, so there's nothing
// left for any bundler's interop to mangle. Types come from the shim in
// pdf-lib-esm.d.ts.
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib/dist/pdf-lib.esm.js";
import fontkit from "@pdf-lib/fontkit";
import { DOC_SANS_BOLD_B64, DOC_SANS_REGULAR_B64 } from "./producerFonts.server";
import { DEFAULT_GEMINI_IMAGE_MODEL } from "./models";

export const DOC_FORMATS = ["pptx", "docx", "pdf"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export type DocSection = {
  heading: string;
  content?: string;
  bullets?: string[];
  /** Optional English prompt for an AI-generated illustration on this slide/section. */
  imagePrompt?: string;
};

export type DocSpec = {
  format: DocFormat;
  title: string;
  subtitle?: string;
  filename: string;
  sections: DocSection[];
  /** Optional English prompt for the title-slide hero graphic. */
  heroImagePrompt?: string;
};

export const CONTENT_TYPES: Record<DocFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

// Caps chosen the same way as the documents pipeline's MAX_CHUNKS cap:
// generous for any realistic agent-produced document, tight enough that a
// runaway model can't make the server build a 300-page file inside a
// server-function execution budget.
export const MAX_SECTIONS = 24;
export const MAX_BULLETS_PER_SECTION = 16;
const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 4000;
const MAX_BULLET_CHARS = 400;

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const MAX_IMAGE_PROMPT_CHARS = 600;
/** Hard cap on generated images per document: 1 hero + up to 4 section shots.
 *  Generation runs in parallel, so the wall-clock cost is one image call,
 *  but each is a paid request on the user's key — don't let a runaway model
 *  order two dozen. */
export const MAX_SECTION_IMAGES = 4;

// Filename slug: the old path ran the title straight through
// sanitizeFilename, which turned every Polish diacritic into "_" —
// live feedback: "Przyszłość" became "Przysz_o__" in the chat link label.
// Transliterate first (NFD strips combining accents; ł/Ł don't decompose so
// they're mapped by hand), then slug to lowercase-hyphens.
export function slugifyFilename(name: string): string {
  const slug = name
    .replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "dokument";
}

export type NormalizeResult = { ok: true; spec: DocSpec } | { ok: false; error: string };

/** Validate + coerce raw tool args (model-produced, so trust nothing). */
export function normalizeDocSpec(args: Record<string, unknown>): NormalizeResult {
  const format = String(args.format ?? "").toLowerCase() as DocFormat;
  if (!DOC_FORMATS.includes(format)) {
    return { ok: false, error: `invalid_format: expected one of ${DOC_FORMATS.join("/")}` };
  }

  const title = clip(args.title, MAX_TITLE_CHARS);
  if (!title) return { ok: false, error: "empty_title" };

  const rawSections = Array.isArray(args.sections) ? args.sections : [];
  const sections: DocSection[] = [];
  for (const raw of rawSections.slice(0, MAX_SECTIONS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const s = raw as Record<string, unknown>;
    const heading = clip(s.heading, MAX_TITLE_CHARS);
    const content = clip(s.content, MAX_TEXT_CHARS);
    const bullets = (Array.isArray(s.bullets) ? s.bullets : [])
      .map((b) => clip(b, MAX_BULLET_CHARS))
      .filter(Boolean)
      .slice(0, MAX_BULLETS_PER_SECTION);
    if (!heading && !content && bullets.length === 0) continue;
    const imagePrompt = clip(s.image_prompt ?? s.imagePrompt, MAX_IMAGE_PROMPT_CHARS);
    sections.push({
      heading: heading || "—",
      content: content || undefined,
      bullets,
      imagePrompt: imagePrompt || undefined,
    });
  }
  if (sections.length === 0) {
    return { ok: false, error: "empty_sections: provide at least one section with real content" };
  }

  const requestedName = clip(args.filename, 120);
  const base = slugifyFilename((requestedName || title).replace(/\.(pptx|docx|pdf)$/i, ""));
  const subtitle = clip(args.subtitle, MAX_TITLE_CHARS);
  const heroImagePrompt = clip(
    (args as Record<string, unknown>).hero_image_prompt ?? args.heroImagePrompt,
    MAX_IMAGE_PROMPT_CHARS,
  );

  return {
    ok: true,
    spec: {
      format,
      title,
      subtitle: subtitle || undefined,
      filename: `${base}.${format}`,
      sections,
      heroImagePrompt: heroImagePrompt || undefined,
    },
  };
}

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

async function generateOneImage(
  prompt: string,
  apiKey: string,
  timeoutMs: number,
): Promise<DocImage | null> {
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
  } finally {
    clearTimeout(timer);
  }
}

/** Generate the hero + section images declared in the spec's prompts.
 *  Best-effort by design: any individual failure just means that slide
 *  renders text-only — never fails the whole document. All images run in
 *  parallel, so wall-clock cost ≈ one image call. */
export async function generateDocImages(
  spec: DocSpec,
  apiKey: string,
  onWarn?: (message: string) => Promise<void> | void,
): Promise<DocImages> {
  const jobs: Array<{ key: "hero" | number; prompt: string }> = [];
  if (spec.heroImagePrompt) jobs.push({ key: "hero", prompt: spec.heroImagePrompt });
  for (const [i, section] of spec.sections.entries()) {
    if (section.imagePrompt) jobs.push({ key: i, prompt: section.imagePrompt });
  }
  const capped = jobs.slice(0, 1 + MAX_SECTION_IMAGES);

  const images: DocImages = { sections: new Map() };
  if (capped.length === 0) return images;

  // 20s per image, all in parallel — kept well under the server-function
  // execution budget even in the worst case, since a text-only slide (image
  // failed/timed out) is an acceptable degradation but a whole run timing
  // out is not.
  const results = await Promise.allSettled(
    capped.map((job) => generateOneImage(job.prompt, apiKey, 20_000)),
  );
  for (const [i, result] of results.entries()) {
    const job = capped[i];
    if (result.status === "fulfilled" && result.value) {
      if (job.key === "hero") images.hero = result.value;
      else images.sections.set(job.key, result.value);
    } else {
      const reason =
        result.status === "rejected"
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : "no image in response";
      await onWarn?.(`image generation failed (${String(job.key)}): ${reason}`);
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

// Single accent used across all three formats — close to the HUD primary so
// generated files feel like they came from the same system.
const ACCENT_HEX = "0891B2"; // cyan-600
const DARK_HEX = "0F172A"; // slate-900
const BODY_HEX = "334155"; // slate-700

async function buildPptx(spec: DocSpec, images: DocImages): Promise<Uint8Array> {
  const pres = new PptxGen();
  pres.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
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
      color: "94A3B8",
      valign: "top",
    });
  }

  for (const [i, section] of spec.sections.entries()) {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT_HEX } });

    const sectionImage = images.sections.get(i);
    // Number badge — filled accent square with the slide number, anchoring
    // the heading instead of a lone footer digit.
    slide.addShape("rect", { x: 0.75, y: 0.55, w: 0.62, h: 0.62, fill: { color: ACCENT_HEX } });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: 0.75,
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
      x: 1.6,
      y: 0.45,
      w: sectionImage ? 6.4 : 11.0,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: DARK_HEX,
      valign: "middle",
    });

    if (sectionImage) {
      // Image panel on the right with a thin accent keyline underneath it.
      slide.addImage({
        data: toDataUri(sectionImage),
        x: 8.15,
        y: 1.55,
        w: 4.43,
        h: 5.0,
        sizing: { type: "cover", w: 4.43, h: 5.0 },
      });
      slide.addShape("rect", { x: 8.15, y: 6.62, w: 4.43, h: 0.06, fill: { color: ACCENT_HEX } });
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
      slide.addText(body, { x: 0.8, y: 1.55, w: bodyWidth, h: 5.4, valign: "top" });
    }
  }

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
    creator: "J.A.R.V.I.S. Producer",
    title: spec.title,
    sections: [{ children }],
  });
  // toArrayBuffer, not toBuffer — the deployed server runtime is not
  // guaranteed to have Node's Buffer (nitro's default target here is
  // cloudflare), and the ArrayBuffer path works everywhere.
  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// pdf — pdf-lib + embedded Unicode font
// ---------------------------------------------------------------------------

/** Word-wrap `text` to `maxWidth` points at `size`. Exported for tests. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

const A4: [number, number] = [595.28, 841.89];
const PDF_MARGIN = 56;

async function buildPdf(spec: DocSpec, images: DocImages): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(spec.title);
  doc.setProducer("J.A.R.V.I.S. Producer");
  const regular = await doc.embedFont(
    Uint8Array.from(atob(DOC_SANS_REGULAR_B64), (c) => c.charCodeAt(0)),
    { subset: true },
  );
  const bold = await doc.embedFont(
    Uint8Array.from(atob(DOC_SANS_BOLD_B64), (c) => c.charCodeAt(0)),
    { subset: true },
  );

  const accent = rgb(0x08 / 255, 0x91 / 255, 0xb2 / 255);
  const dark = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);
  const body = rgb(0x33 / 255, 0x41 / 255, 0x55 / 255);
  const maxWidth = A4[0] - 2 * PDF_MARGIN;

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - PDF_MARGIN;

  const ensureRoom = (needed: number) => {
    if (y - needed < PDF_MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - PDF_MARGIN;
    }
  };

  const drawWrapped = (
    text: string,
    font: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    indent = 0,
    gapAfter = 6,
  ) => {
    const lineHeight = size * 1.35;
    for (const line of wrapText(text, font, size, maxWidth - indent)) {
      ensureRoom(lineHeight);
      page.drawText(line, { x: PDF_MARGIN + indent, y: y - size, size, font, color });
      y -= lineHeight;
    }
    y -= gapAfter;
  };

  // Title block with accent rule.
  drawWrapped(spec.title, bold, 26, dark, 0, 4);
  if (spec.subtitle) drawWrapped(spec.subtitle, regular, 13, body, 0, 4);
  ensureRoom(14);
  page.drawRectangle({ x: PDF_MARGIN, y: y - 3, width: 64, height: 3, color: accent });
  y -= 24;

  if (images.hero) {
    // Full-width hero banner under the title rule; pdf-lib reports real
    // image dimensions, so the aspect ratio is always preserved.
    try {
      const img =
        images.hero.mime === "image/jpeg"
          ? await doc.embedJpg(images.hero.bytes)
          : await doc.embedPng(images.hero.bytes);
      const height = Math.min((maxWidth * img.height) / img.width, 300);
      const width = (height * img.width) / img.height;
      ensureRoom(height + 12);
      page.drawImage(img, { x: PDF_MARGIN, y: y - height, width, height });
      y -= height + 18;
    } catch {
      // Unsupported/corrupt image — the document is still worth producing.
    }
  }

  for (const section of spec.sections) {
    ensureRoom(60); // keep a heading from landing alone at the page bottom
    drawWrapped(section.heading, bold, 16, dark, 0, 4);
    if (section.content) drawWrapped(section.content, regular, 11.5, body, 0, 6);
    for (const bullet of section.bullets ?? []) {
      drawWrapped(`•  ${bullet}`, regular, 11.5, body, 10, 2);
    }
    y -= 10;
  }

  return doc.save();
}

// ---------------------------------------------------------------------------

export async function buildDocument(
  spec: DocSpec,
  images: DocImages = NO_IMAGES,
): Promise<Uint8Array> {
  switch (spec.format) {
    case "pptx":
      return buildPptx(spec, images);
    case "docx":
      return buildDocx(spec, images);
    case "pdf":
      return buildPdf(spec, images);
  }
}
