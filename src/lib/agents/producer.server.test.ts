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
  unwrapDefault,
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
  hero: { bytes: TINY_PNG, mime: "image/png", sourceUrl: "https://example.com/hero.png" },
  sections: new Map([
    [0, { bytes: TINY_PNG, mime: "image/png", sourceUrl: "https://example.com/s0.png" }],
  ]),
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
  slides: POLISH_BLOCKS.map((b) => ({ ...b, layout: "bullets" as const })),
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
    // …a kod, który po prostu przechodzi po treści, dostaje z obu ten sam
    // materiał. Slajd niesie ponadto swój układ, więc porównujemy to, co
    // faktycznie jest wspólne, zamiast udawać, że kształty są identyczne.
    const common = (b: { heading: string; content?: string }) => ({
      heading: b.heading,
      content: b.content,
    });
    expect(blocksOf(deck.spec).map(common)).toEqual(blocksOf(doc.spec).map(common));
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

describe("układy slajdów", () => {
  const deck = (slide: Record<string, unknown>) =>
    normalizeDocSpec({ format: "pptx", title: "t", sections: [slide] });

  const layoutOf = (res: ReturnType<typeof normalizeDocSpec>) => {
    if (!res.ok || res.spec.format !== "pptx") return null;
    return res.spec.slides[0].layout;
  };

  it("keeps a layout whose data is actually there", () => {
    expect(
      layoutOf(deck({ heading: "Wyniki", layout: "metrics", metrics: [{ value: "42%" }] })),
    ).toBe("metrics");
    expect(
      layoutOf(
        deck({
          heading: "Przed i po",
          layout: "compare",
          columns: [
            { heading: "Przed", bullets: ["a"] },
            { heading: "Po", bullets: ["b"] },
          ],
        }),
      ),
    ).toBe("compare");
    expect(layoutOf(deck({ heading: "Teza", layout: "statement", content: "Jedno zdanie." }))).toBe(
      "statement",
    );
    expect(
      layoutOf(deck({ heading: "Część I", layout: "photo", image_query: "warsaw skyline" })),
    ).toBe("photo");
  });

  it("degrades to bullets when the layout's own data is missing", () => {
    // To jest gwarancja, na której stoi cały renderer: układ bez swoich
    // danych wyrenderowałby się jako pusta ramka z nagłówkiem, czyli dziura
    // w prezentacji zamiast treści, którą model faktycznie napisał.
    expect(layoutOf(deck({ heading: "h", content: "c", layout: "metrics" }))).toBe("bullets");
    expect(
      layoutOf(
        deck({ heading: "h", content: "c", layout: "compare", columns: [{ heading: "A" }] }),
      ),
    ).toBe("bullets");
    expect(layoutOf(deck({ heading: "h", bullets: ["x"], layout: "photo" }))).toBe("bullets");
    expect(layoutOf(deck({ heading: "h", layout: "statement", bullets: [] }))).toBe("bullets");
  });

  it("falls back to bullets for an unknown or missing layout", () => {
    expect(layoutOf(deck({ heading: "h", content: "c", layout: "carousel" }))).toBe("bullets");
    expect(layoutOf(deck({ heading: "h", content: "c" }))).toBe("bullets");
  });

  it("drops a metric with no value and caps the row at four", () => {
    const res = deck({
      heading: "h",
      layout: "metrics",
      metrics: [
        { value: "1", label: "a" },
        { label: "brak wartości" },
        { value: "2" },
        { value: "3" },
        { value: "4" },
        { value: "5" },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.spec.format !== "pptx") return;
    const metrics = res.spec.slides[0].metrics ?? [];
    expect(metrics).toHaveLength(4);
    expect(metrics.map((m) => m.value)).toEqual(["1", "2", "3", "4"]);
  });

  it("never leaks layout fields into a Word document", () => {
    // Układy, liczby i kolumny to pojęcia slajdu. Przepuszczenie ich do
    // docx tylko dlatego, że wspólna pętla je policzyła, odtworzyłoby
    // sprzęgnięcie formatów, przez które prezentacje były kalekie.
    const res = normalizeDocSpec({
      format: "docx",
      title: "t",
      sections: [{ heading: "h", content: "c", layout: "metrics", metrics: [{ value: "42%" }] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.spec.format !== "docx") return;
    const section = res.spec.sections[0];
    expect(section).not.toHaveProperty("layout");
    expect(section).not.toHaveProperty("metrics");
    expect(section).not.toHaveProperty("columns");
    expect(section.content).toBe("c");
  });

  it("builds a pptx with every layout without throwing", async () => {
    const bytes = await buildDocument({
      format: "pptx",
      title: "Wszystkie układy",
      filename: "uklady.pptx",
      slides: [
        { layout: "bullets", heading: "Punkty", content: "Treść", bullets: ["a", "b"] },
        { layout: "section", heading: "Część II", content: "Wprowadzenie" },
        { layout: "statement", heading: "Wniosek", content: "Jedno mocne zdanie." },
        {
          layout: "metrics",
          heading: "Liczby",
          metrics: [
            { value: "42%", label: "udział" },
            { value: "3.2 mln", label: "zasięg" },
            { value: "17x", label: "wzrost" },
            { value: "8", label: "rynki" },
          ],
        },
        {
          layout: "compare",
          heading: "Przed i po",
          columns: [
            { heading: "Przed", bullets: ["wolno", "drogo"] },
            { heading: "Po", bullets: ["szybko", "taniej"] },
          ],
        },
        { layout: "photo", heading: "Otwarcie", imageQuery: "city skyline" },
      ],
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("builds every layout with images embedded too", async () => {
    const withImages: DocImages = {
      hero: TINY_IMAGES.hero,
      sections: new Map([
        [0, { bytes: TINY_PNG, mime: "image/png", sourceUrl: "https://example.com/a.png" }],
        [1, { bytes: TINY_PNG, mime: "image/png", sourceUrl: "https://example.com/b.png" }],
      ]),
    };
    const bytes = await buildDocument(
      {
        format: "pptx",
        title: "Z obrazami",
        filename: "obrazy.pptx",
        heroImageQuery: "hero",
        slides: [
          { layout: "bullets", heading: "Punkty", bullets: ["a"], imageQuery: "x" },
          { layout: "photo", heading: "Pełny kadr", imageQuery: "y" },
        ],
      },
      withImages,
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("zdjęcia", () => {
  it("ignores an AI image prompt instead of reviving the generated-graphics path", () => {
    // Ścieżka generowania obrazów przez model została wycięta: bywała
    // rozjeżdżoną atrapą tematu, kosztowała płatne żądanie i wracała jako 503
    // częściej niż jako obraz. Model może jeszcze przez jakiś czas wysyłać
    // „image_prompt" z rozpędu — ma to wpaść do kosza, nie do specyfikacji.
    const res = normalizeDocSpec({
      format: "pptx",
      title: "t",
      hero_image_prompt: "sleek phone on dark glass",
      sections: [{ heading: "h", content: "c", image_prompt: "macro camera lens" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec).not.toHaveProperty("heroImagePrompt");
    expect(blocksOf(res.spec)[0]).not.toHaveProperty("imagePrompt");
    // Sam prompt nie jest też traktowany jak prośba o zdjęcie.
    expect(specHasImagePrompts(res.spec)).toBe(false);
  });

  it("caps image lookups at 1 hero + 4 blocks", async () => {
    // Każde źródło zawodzi, więc test nie zależy od tego, które akurat
    // odpowiedziało — liczy WYŁĄCZNIE to, o ile różnych tematów w ogóle
    // zapytaliśmy. To jest limit, który chroni budżet zadania w tle.
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const spec: DeckSpec = {
      format: "pptx",
      title: "t",
      filename: "t.pptx",
      heroImageQuery: "hero subject",
      slides: Array.from({ length: 8 }, (_, i) => ({
        layout: "bullets" as const,
        heading: `s${i}`,
        content: "c",
        imageQuery: `subject ${i}`,
      })),
    };
    const images = await generateDocImages(spec, "test-key");

    const asked = new Set<string>();
    for (const [url] of fetchMock.mock.calls) {
      const text = String(url);
      if (text.includes("hero%20subject")) asked.add("hero");
      for (let i = 0; i < 8; i += 1) if (text.includes(`subject%20${i}`)) asked.add(String(i));
    }
    expect(asked.size).toBe(5); // 1 tytułowe + 4 bloki
    expect(images.hero).toBeUndefined();
    expect(images.sections.size).toBe(0);
  });

  it("specHasImagePrompts drives async enrichment from photo queries", () => {
    const base = { format: "pptx" as const, title: "t", filename: "t.pptx" };
    expect(
      specHasImagePrompts({ ...base, slides: [{ layout: "bullets", heading: "h", content: "c" }] }),
    ).toBe(false);
    expect(specHasImagePrompts({ ...base, heroImageQuery: "samsung phone", slides: [] })).toBe(
      true,
    );
    expect(
      specHasImagePrompts({
        ...base,
        slides: [{ layout: "bullets", heading: "h", imageQuery: "real photo" }],
      }),
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

describe("unwrapDefault — zgodność ESM/CJS przy pakowaniu", () => {
  // Prezentacje przestały się budować na „PptxGen is not a constructor",
  // choć ani biblioteka, ani jej wersja, ani kod budujący się nie zmieniły.
  // Zmieniła się POSTAĆ, w jakiej pakowanie podało domyślny eksport.
  class Fake {}

  it("przepuszcza klasę podaną wprost", () => {
    expect(unwrapDefault(Fake)).toBe(Fake);
  });

  it("wyłuskuje klasę owiniętą w { default }", () => {
    // Tak wygląda CommonJS przerobiony na moduł przez bundler.
    expect(unwrapDefault({ default: Fake } as unknown as typeof Fake)).toBe(Fake);
  });

  it("nie gubi obiektu, który po prostu nie ma default", () => {
    const plain = { a: 1 };
    expect(unwrapDefault(plain)).toBe(plain);
  });

  it("znosi null i undefined bez wyjątku", () => {
    expect(unwrapDefault(null)).toBeNull();
    expect(unwrapDefault(undefined)).toBeUndefined();
  });
});

describe("kafle „metrics” — wartość musi być liczbą", () => {
  // Żywy przypadek z prezentacji o GTA VI: czwarty kafel dostał
  // „Najszybszy trailer w historii YouTube", obcięcie do 12 znaków dało
  // „Najszybszy t", a render pokazał „Najszyb szy t".
  const withMetrics = (metrics: unknown) => {
    const res = normalizeDocSpec({
      format: "pptx",
      title: "T",
      sections: [{ heading: "Liczby", layout: "metrics", metrics }],
    });
    if (!res.ok) throw new Error(res.error);
    if (res.spec.format !== "pptx") throw new Error("spodziewano się prezentacji");
    return res.spec.slides[0];
  };

  it("wyrzuca kafel bez ani jednej cyfry", () => {
    const slide = withMetrics([
      { value: "90+ mln", label: "wyświetlenia" },
      { value: "Najszybszy trailer w historii YouTube", label: "rekord" },
    ]);
    expect(slide.metrics).toHaveLength(1);
    expect(slide.metrics?.[0].value).toBe("90+ mln");
  });

  it("gdy nie zostanie żadna liczba, slajd wraca do punktów", () => {
    // Lepiej zwykły slajd niż siatka pustych kafli.
    const slide = withMetrics([{ value: "Rekord" }, { value: "Najszybszy" }]);
    expect(slide.layout).toBe("bullets");
  });

  it("nie rusza liczb z jednostkami i przybliżeniami", () => {
    const slide = withMetrics([{ value: "~475 tys." }, { value: "100+ mln" }, { value: "6,5 s" }]);
    expect(slide.metrics).toHaveLength(3);
  });
});
