// Producer document builders — the parts most likely to regress silently:
//
// 1. normalizeDocSpec: model-produced args are untrusted — malformed input
//    must come back as a typed error, never throw or produce a broken spec.
// 2. buildDocument: each format must produce real bytes with the right
//    container signature (pptx/docx are ZIPs → "PK", pdf → "%PDF").
// 3. Polish diacritics in PDF: the entire reason producerFonts.server.ts
//    exists — pdf-lib's StandardFonts throw on the first "ł". If someone
//    "simplifies" the embedded font away, this is the test that catches it.

import { describe, expect, it } from "vitest";
import { buildDocument, normalizeDocSpec, type DocSpec } from "./producer.server";

const POLISH_SPEC: Omit<DocSpec, "format"> = {
  title: "Zażółć gęślą jaźń — raport",
  subtitle: "Pełny polski zestaw znaków: ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ",
  filename: "raport.pdf",
  sections: [
    {
      heading: "Wnioski końcowe",
      content: "Świeża treść z polskimi znakami: łódź, źdźbło, żółw.\n\nDrugi akapit.",
      bullets: ["Pierwszy wniosek — ważny", "Drugi wniosek (ok. 50%)"],
    },
    { heading: "Źródła", bullets: ["https://example.com/artykuł"] },
  ],
};

describe("normalizeDocSpec", () => {
  it("accepts a complete spec and derives the filename from the title", () => {
    const res = normalizeDocSpec({
      format: "pptx",
      title: "Plan kwartalny: Q3",
      sections: [{ heading: "Cele", bullets: ["Cel 1"] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.filename).toBe("Plan_kwartalny__Q3.pptx");
    expect(res.spec.sections).toHaveLength(1);
  });

  it("rejects unknown formats", () => {
    const res = normalizeDocSpec({ format: "xlsx", title: "t", sections: [{ heading: "h" }] });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("invalid_format") });
  });

  it("rejects an empty title and content-free sections", () => {
    expect(normalizeDocSpec({ format: "pdf", title: "  ", sections: [{ heading: "h" }] }).ok).toBe(
      false,
    );
    expect(
      normalizeDocSpec({ format: "pdf", title: "t", sections: [{}, { bullets: [] }] }).ok,
    ).toBe(false);
  });

  it("drops non-object sections and clips malformed bullets instead of throwing", () => {
    const res = normalizeDocSpec({
      format: "docx",
      title: "t",
      sections: ["garbage", null, { heading: "ok", bullets: [42, "  real  ", ""] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.sections).toHaveLength(1);
    expect(res.spec.sections[0].bullets).toEqual(["real"]);
  });

  it("normalizes a user-supplied filename and strips a duplicate extension", () => {
    const res = normalizeDocSpec({
      format: "pdf",
      title: "t",
      filename: "mój raport.pdf",
      sections: [{ heading: "h", content: "c" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.filename).toBe("m_j_raport.pdf");
  });
});

describe("buildDocument", () => {
  it("builds a pptx (ZIP container)", async () => {
    const bytes = await buildDocument({ ...POLISH_SPEC, format: "pptx" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("builds a docx (ZIP container)", async () => {
    const bytes = await buildDocument({ ...POLISH_SPEC, format: "docx" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("builds a pdf with Polish diacritics without throwing", async () => {
    const bytes = await buildDocument({ ...POLISH_SPEC, format: "pdf" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("paginates long content instead of overflowing one PDF page", async () => {
    const bytes = await buildDocument({
      format: "pdf",
      title: "Długi dokument",
      filename: "dlugi.pdf",
      sections: Array.from({ length: 12 }, (_, i) => ({
        heading: `Sekcja ${i + 1}`,
        content: "Zdanie testowe z polskimi znakami: żółć. ".repeat(40),
      })),
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
