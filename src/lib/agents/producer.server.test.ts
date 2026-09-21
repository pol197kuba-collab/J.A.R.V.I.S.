// F.O.R.G.E. document builders — the parts most likely to regress silently:
//
// 1. normalizeDocSpec: model-produced args are untrusted — malformed input
//    must come back as a typed error, never throw or produce a broken spec.
// 2. buildDocument: each format must produce real bytes with the right
//    container signature (pptx and docx are both ZIPs → "PK").
// 3. Rozdzielenie opisu: prezentacja niesie `slides`, dokument `sections`.
//    Model widzi w obu przypadkach to samo pole „sections" — to jest jego
//    interfejs, nie nasz kształt wewnętrzny — więc normalizacja musi
//    przełożyć jedno na drugie i nie wolno jej tego pomylić.

import { describe, expect, it } from "vitest";
import {
  blocksOf,
  buildDocument,
  generateDocImages,
  normalizeDocSpec,
  pngDims,
  slugifyFilename,
  specHasImagePrompts,
  type DocImages,
  type DeckSpec,
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

const POLISH_BLOCKS = [
  {
    heading: "Wnioski końcowe",
    content: "Świeża treść z polskimi znakami: łódź, źdźbło, żółw.\n\nDrugi akapit.",
    bullets: ["Pierwszy wniosek — ważny", "Drugi wniosek (ok. 50%)"],
  },
  { heading: "Źródła", bullets: ["https://example.com/artykuł"] },
];

const POLISH_COMMON = {
  title: "Zażółć gęślą jaźń — raport",
  subtitle: "Pełny polski zestaw znaków: ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ",
};

const POLISH_DECK: DeckSpec = {
  ...POLISH_COMMON,
  format: "pptx",
  filename: "raport.pptx",
  slides: POLISH_BLOCKS,
};

const POLISH_DOC: DocSpec = {
  ...POLISH_COMMON,
  format: "docx",
  filename: "raport.docx",
  sections: POLISH_BLOCKS,
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
    // Wejściowe „sections" modelu ląduje dla pptx w `slides` — to jest cały
    // sens rozdzielenia opisu i regresja, która najłatwiej przeszłaby cicho.
    expect(res.spec.format === "pptx" && res.spec.slides).toHaveLength(1);
    expect(blocksOf(res.spec)).toHaveLength(1);
  });

  it("routes identical input to slides for a deck and sections for a document", () => {
    // Sedno rozdzielenia opisu: model podaje jedno pole „sections" dla obu
    // formatów, a wewnątrz rozchodzi się to na dwa różne kształty. Gdyby
    // kiedyś zrosło się z powrotem w jeden, prezentacje znów mogłyby zawierać
    // wyłącznie to, co wyraża Word — i to jest ta regresja, którą chcemy tu
    // złapać, a nie literówkę w nazwie pola.
    const args = { title: "t", sections: [{ heading: "h", content: "c" }] };

    const deck = normalizeDocSpec({ ...args, format: "pptx" });
    const doc = normalizeDocSpec({ ...args, format: "docx" });
    expect(deck.ok && doc.ok).toBe(true);
    if (!deck.ok || !doc.ok) return;

    expect(deck.spec).toHaveProperty("slides");
    expect(deck.spec).not.toHaveProperty("sections");
    expect(doc.spec).toHaveProperty("sections");
    expect(doc.spec).not.toHaveProperty("slides");
    // …a kod, który po prostu przechodzi po treści, nie musi o tym wiedzieć.
    expect(blocksOf(deck.spec)).toEqual(blocksOf(doc.spec));
  });

  it("rejects unknown formats", () => {
    const res = normalizeDocSpec({ format: "xlsx", title: "t", sections: [{ heading: "h" }] });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("invalid_format") });
  });

  it("rejects an empty title and content-free sections", () => {
    expect(normalizeDocSpec({ format: "docx", title: "  ", sections: [{ heading: "h" }] }).ok).toBe(
      false,
    );
    expect(
      normalizeDocSpec({ format: "docx", title: "t", sections: [{}, { bullets: [] }] }).ok,
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
    expect(blocksOf(res.spec)).toHaveLength(1);
    expect(blocksOf(res.spec)[0].bullets).toEqual(["real"]);
  });

  it("normalizes a user-supplied filename and forces the real extension", () => {
    // Rozszerzenie z nazwy podanej przez model jest odrzucane, nie doklejane.
    // „.pdf" zostaje na liście zdejmowanych końcówek celowo, mimo że tego
    // formatu już nie produkujemy: model nadal potrafi taką nazwę napisać,
    // a „moj-raport.pdf.docx" byłoby gorsze niż jakikolwiek brak walidacji.
    const res = normalizeDocSpec({
      format: "docx",
      title: "t",
      filename: "mój raport.pdf",
      sections: [{ heading: "h", content: "c" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.filename).toBe("moj-raport.docx");
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
    expect(blocksOf(res.spec)[0].imagePrompt).toBe("macro camera lens");
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

    const spec: DeckSpec = {
      format: "pptx",
      title: "t",
      filename: "t.pptx",
      heroImagePrompt: "hero",
      slides: Array.from({ length: 8 }, (_, i) => ({
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
      { format: "pptx", title: "t", filename: "t.pptx", heroImagePrompt: "hero", slides: [] },
      "test-key",
    );
    // 503 then 200 — the hero image survives instead of degrading to text-only.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(images.hero?.mime).toBe("image/png");
  });

  it("specHasImagePrompts drives async enrichment (AI prompts OR web-photo queries)", () => {
    const base = { format: "pptx" as const, title: "t", filename: "t.pptx" };
    expect(specHasImagePrompts({ ...base, slides: [{ heading: "h", content: "c" }] })).toBe(false);
    expect(specHasImagePrompts({ ...base, heroImagePrompt: "hero", slides: [] })).toBe(true);
    expect(specHasImagePrompts({ ...base, heroImageQuery: "samsung phone", slides: [] })).toBe(
      true,
    );
    expect(specHasImagePrompts({ ...base, slides: [{ heading: "h", imagePrompt: "phone" }] })).toBe(
      true,
    );
    expect(
      specHasImagePrompts({ ...base, slides: [{ heading: "h", imageQuery: "real photo" }] }),
    ).toBe(true);
  });

  it("normalizeDocSpec picks up image_query and hero_image_query", () => {
    const res = normalizeDocSpec({
      format: "pptx",
      title: "t",
      hero_image_query: "  Samsung Galaxy S26 Ultra  ",
      sections: [{ heading: "h", content: "c", image_query: "camera module" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.heroImageQuery).toBe("Samsung Galaxy S26 Ultra");
    expect(blocksOf(res.spec)[0].imageQuery).toBe("camera module");
  });

  it("generateDocImages is a no-op without prompts (no network)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const images = await generateDocImages(
      {
        format: "docx",
        title: "t",
        filename: "t.docx",
        sections: [{ heading: "h", content: "c" }],
      },
      "test-key",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(images.hero).toBeUndefined();
    expect(images.sections.size).toBe(0);
  });
});

describe("buildDocument", () => {
  it("builds a pptx (ZIP container)", async () => {
    const bytes = await buildDocument(POLISH_DECK);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("builds a docx (ZIP container)", async () => {
    const bytes = await buildDocument(POLISH_DOC);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("embeds images in both formats without throwing", async () => {
    for (const spec of [POLISH_DECK, POLISH_DOC]) {
      const bytes = await buildDocument(spec, TINY_IMAGES);
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });

  it("builds a long document without throwing", async () => {
    // Dawniej pilnowało to łamania stron w PDF-ie, który sam liczył linie.
    // Word łamie strony sam, więc zostaje to, co nadal może się wywrócić:
    // dużo sekcji z długą treścią i polskimi znakami.
    const bytes = await buildDocument({
      format: "docx",
      title: "Długi dokument",
      filename: "dlugi.docx",
      sections: Array.from({ length: 12 }, (_, i) => ({
        heading: `Sekcja ${i + 1}`,
        content: "Zdanie testowe z polskimi znakami: żółć. ".repeat(40),
      })),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });
});
