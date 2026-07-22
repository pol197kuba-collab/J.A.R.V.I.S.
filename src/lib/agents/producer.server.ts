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
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { sanitizeFilename } from "@/lib/documents/chunking";
import { DOC_SANS_BOLD_B64, DOC_SANS_REGULAR_B64 } from "./producerFonts.server";

export const DOC_FORMATS = ["pptx", "docx", "pdf"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export type DocSection = {
  heading: string;
  content?: string;
  bullets?: string[];
};

export type DocSpec = {
  format: DocFormat;
  title: string;
  subtitle?: string;
  filename: string;
  sections: DocSection[];
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
    sections.push({ heading: heading || "—", content: content || undefined, bullets });
  }
  if (sections.length === 0) {
    return { ok: false, error: "empty_sections: provide at least one section with real content" };
  }

  const requestedName = clip(args.filename, 120);
  const base = sanitizeFilename((requestedName || title).replace(/\.(pptx|docx|pdf)$/i, ""));
  const subtitle = clip(args.subtitle, MAX_TITLE_CHARS);

  return {
    ok: true,
    spec: {
      format,
      title,
      subtitle: subtitle || undefined,
      filename: `${base}.${format}`,
      sections,
    },
  };
}

// ---------------------------------------------------------------------------
// pptx — pptxgenjs
// ---------------------------------------------------------------------------

// Single accent used across all three formats — close to the HUD primary so
// generated files feel like they came from the same system.
const ACCENT_HEX = "0891B2"; // cyan-600
const DARK_HEX = "0F172A"; // slate-900
const BODY_HEX = "334155"; // slate-700

async function buildPptx(spec: DocSpec): Promise<Uint8Array> {
  const pres = new PptxGen();
  pres.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pres.layout = "WIDE";

  // Title slide — dark, accent bar, title + optional subtitle.
  const title = pres.addSlide();
  title.background = { color: DARK_HEX };
  title.addShape("rect", { x: 0.9, y: 3.62, w: 1.6, h: 0.07, fill: { color: ACCENT_HEX } });
  title.addText(spec.title, {
    x: 0.85,
    y: 2.2,
    w: 11.6,
    h: 1.3,
    fontSize: 40,
    bold: true,
    color: "F8FAFC",
    valign: "bottom",
  });
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.85,
      y: 3.85,
      w: 11.6,
      h: 0.8,
      fontSize: 18,
      color: "94A3B8",
      valign: "top",
    });
  }

  for (const [i, section] of spec.sections.entries()) {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT_HEX } });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: 12.2,
      y: 6.85,
      w: 0.9,
      h: 0.4,
      fontSize: 12,
      color: "94A3B8",
      align: "right",
    });
    slide.addText(section.heading, {
      x: 0.75,
      y: 0.45,
      w: 11.9,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: DARK_HEX,
      valign: "middle",
    });

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
      slide.addText(body, { x: 0.8, y: 1.55, w: 11.7, h: 5.4, valign: "top" });
    }
  }

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// docx — docx
// ---------------------------------------------------------------------------

async function buildDocx(spec: DocSpec): Promise<Uint8Array> {
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
  const buffer = await Packer.toBuffer(doc);
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

async function buildPdf(spec: DocSpec): Promise<Uint8Array> {
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

export async function buildDocument(spec: DocSpec): Promise<Uint8Array> {
  switch (spec.format) {
    case "pptx":
      return buildPptx(spec);
    case "docx":
      return buildDocx(spec);
    case "pdf":
      return buildPdf(spec);
  }
}
