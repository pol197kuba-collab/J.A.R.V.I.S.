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
import {
  buildDocument,
  generateDocImages,
  normalizeDocSpec,
  pngDims,
  slugifyFilename,
  type DocImages,
  type DocSpec,
} from "./producer.server";
import { vi, afterEach } from "vitest";

// 1x1 opaque PNG — enough for every embed path (pptx data-URI, docx
// ImageRun, pdf embedPng) without shipping a real asset into the test.
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const TINY_IMAGES: DocImages = {
  hero: { bytes: TINY_PNG, mime: "image/png" },
  sections: new Map([[0, { bytes: TINY_PNG, mime: "image/png" }]]),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(res.spec.filename).toBe("plan-kwartalny-q3.pptx");
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
    expect(res.spec.filename).toBe("moj-raport.pdf");
  });
});

describe("slugifyFilename", () => {
  it("transliterates Polish diacritics instead of underscoring them", () => {
    expect(slugifyFilename("Samsung S26 Ultra: Przyszłość Mobilnej Innowacji")).toBe(
      "samsung-s26-ultra-przyszlosc-mobilnej-innowacji",
    );
    expect(slugifyFilename("Zażółć gęślą jaźń — ŁÓDŹ 2026")).toBe("zazolc-gesla-jazn-lodz-2026");
  });

  it("never returns an empty slug", () => {
    expect(slugifyFilename("???")).toBe("dokument");
  });
});

describe("image prompts", () => {
  it("normalizeDocSpec picks up hero_image_prompt and per-section image_prompt", () => {
    const res = normalizeDocSpec({
      format: "pptx",
      title: "t",
      hero_image_prompt: "  sleek phone on dark glass  ",
      sections: [{ heading: "h", content: "c", image_prompt: "macro camera lens" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.heroImagePrompt).toBe("sleek phone on dark glass");
    expect(res.spec.sections[0].imagePrompt).toBe("macro camera lens");
  });

  it("generateDocImages parses inlineData and caps the number of calls at 1+4", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const spec: DocSpec = {
      format: "pptx",
      title: "t",
      filename: "t.pptx",
      heroImagePrompt: "hero",
      sections: Array.from({ length: 8 }, (_, i) => ({
        heading: `s${i}`,
        content: "c",
        imagePrompt: `img${i}`,
      })),
    };
    const images = await generateDocImages(spec, "test-key");
    expect(fetchMock).toHaveBeenCalledTimes(5); // 1 hero + 4 section cap
    expect(images.hero?.mime).toBe("image/png");
    expect(images.sections.size).toBe(4);
    expect(pngDims(images.hero!.bytes)).toEqual({ width: 1, height: 1 });
  });

  it("generateDocImages retries a transient 503 and recovers the image", async () => {
    const PNG =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      // First attempt: the 503 storm the image model was throwing live.
      if (call === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => '{"error":{"code":503,"status":"UNAVAILABLE"}}',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } },
          ],
        }),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const images = await generateDocImages(
      { format: "pdf", title: "t", filename: "t.pdf", heroImagePrompt: "hero", sections: [] },
      "test-key",
    );
    // 503 then 200 — the hero image survives instead of degrading to text-only.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(images.hero?.mime).toBe("image/png");
  });

  it("generateDocImages is a no-op without prompts (no network)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const images = await generateDocImages(
      { format: "pdf", title: "t", filename: "t.pdf", sections: [{ heading: "h", content: "c" }] },
      "test-key",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(images.hero).toBeUndefined();
    expect(images.sections.size).toBe(0);
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

  it("embeds images in all three formats without throwing", async () => {
    for (const format of ["pptx", "docx", "pdf"] as const) {
      const bytes = await buildDocument({ ...POLISH_SPEC, format }, TINY_IMAGES);
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
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
