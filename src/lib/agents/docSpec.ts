// F.O.R.G.E. — opis tego, CO ma powstać. Bez ani jednej linijki rysowania.
//
// DLACZEGO TO SĄ DWA TYPY, A NIE JEDEN.
//
// Wcześniej jeden `DocSpec` obsługiwał prezentację, dokument i PDF naraz.
// Brzmi oszczędnie, ale ma wbudowany podatek: wspólny opis może zawierać
// wyłącznie to, co wyrażają WSZYSTKIE formaty — czyli tytuł, sekcje i punkty.
// Prezentacja nie mogła dostać slajdu „wielka liczba" ani przekładki sekcji,
// bo dokument Worda nie ma takiego pojęcia. Nudne slajdy nie brały się więc
// ze słabego modelu ani ze złego renderera: brały się stąd, że wspólny
// mianownik trzech formatów to najuboższy z nich.
//
// Stąd podział. Prezentacja to PŁÓTNO (slajdy o stałych wymiarach, elementy
// rozmieszczane), dokument to PŁYN (tekst leci, strony łamią się same). To są
// dwa różne problemy i udawanie, że to jeden, kosztowało dokładnie to, co
// miało oszczędzić. Teraz zmiana w prezentacjach nie dotyka dokumentów i
// odwrotnie — a `DeckSpec` może rosnąć o rzeczy, które mają sens tylko na
// slajdzie, nie oglądając się na Worda.
//
// Plik jest CZYSTY: bez importów serwerowych i bez Reacta. Dzięki temu czytają
// go zarówno renderery na serwerze, jak i podgląd slajdów w przeglądarce —
// podgląd pokazuje tę samą specyfikację, z której zbudowano plik, zamiast
// własnej interpretacji czegoś podobnego.

export const DOC_FORMATS = ["pptx", "docx"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

// Limity dobrane tak samo jak MAX_CHUNKS w potoku dokumentów: z zapasem na
// każdy realny plik agenta, ale ciasno na tyle, że rozbiegany model nie każe
// serwerowi zbudować 300-stronicowego pliku w budżecie jednego wywołania.
export const MAX_SECTIONS = 24;
export const MAX_BULLETS_PER_SECTION = 16;
const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 4000;
const MAX_BULLET_CHARS = 400;
const MAX_IMAGE_PROMPT_CHARS = 600;

/** Twardy limit obrazów na plik: 1 hero + do 4 na sekcje. Każdy to płatne
 *  żądanie na kluczu użytkownika — rozbiegany model nie zamówi dwudziestu. */
export const MAX_SECTION_IMAGES = 4;

/** Skąd wziąć grafikę dla tego bloku. Wspólne dla slajdu i sekcji dokumentu,
 *  bo potok obrazów jest jeden i nie interesuje go format wyjściowy. */
type ImageRefs = {
  /** Angielski prompt dla grafiki generowanej przez model. */
  imagePrompt?: string;
  /** Fraza do wyszukania PRAWDZIWEGO zdjęcia. Ma pierwszeństwo przed
   *  promptem — realne zdjęcie nie zależy od kapryśnego modelu graficznego. */
  imageQuery?: string;
};

/** Jeden slajd prezentacji. */
export type DeckSlide = ImageRefs & {
  heading: string;
  content?: string;
  bullets?: string[];
};

/** Jedna sekcja dokumentu. */
export type DocSection = ImageRefs & {
  heading: string;
  content?: string;
  bullets?: string[];
};

export type DeckSpec = {
  format: "pptx";
  title: string;
  subtitle?: string;
  filename: string;
  slides: DeckSlide[];
  heroImagePrompt?: string;
  heroImageQuery?: string;
};

export type DocSpec = {
  format: "docx";
  title: string;
  subtitle?: string;
  filename: string;
  sections: DocSection[];
  heroImagePrompt?: string;
  heroImageQuery?: string;
};

/** Cokolwiek Forge potrafi zbudować. */
export type ProducerSpec = DeckSpec | DocSpec;

export const isDeck = (spec: ProducerSpec): spec is DeckSpec => spec.format === "pptx";

/**
 * Bloki treści niezależnie od formatu — slajdy albo sekcje.
 *
 * Istnieje po to, żeby potok obrazów (i cokolwiek innego, co po prostu
 * przechodzi po treści) nie musiał rozgałęziać się na format. To jedyne
 * miejsce, które zna oba kształty; reszta kodu albo jest rendererem
 * konkretnego formatu, albo woła to.
 */
export const blocksOf = (spec: ProducerSpec): readonly (DeckSlide | DocSection)[] =>
  isDeck(spec) ? spec.slides : spec.sections;

export const CONTENT_TYPES: Record<DocFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Slug nazwy pliku: stara ścieżka puszczała tytuł wprost przez
// sanitizeFilename, co zamieniało każdy polski ogonek w „_" — z żywego
// zgłoszenia: „Przyszłość" stawało się „Przysz_o__". Najpierw więc
// transliteracja (NFD zdejmuje znaki łączące; ł/Ł się nie rozkładają, więc są
// mapowane ręcznie), dopiero potem slug.
export function slugifyFilename(name: string): string {
  const slug = name
    .replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "dokument";
}

export type NormalizeResult = { ok: true; spec: ProducerSpec } | { ok: false; error: string };

/** Waliduje i sprowadza do postaci kanonicznej surowe argumenty narzędzia.
 *  Pochodzą od modelu, więc nie ufamy tu niczemu. */
export function normalizeDocSpec(args: Record<string, unknown>): NormalizeResult {
  const format = String(args.format ?? "").toLowerCase() as DocFormat;
  if (!DOC_FORMATS.includes(format)) {
    return { ok: false, error: `invalid_format: expected one of ${DOC_FORMATS.join("/")}` };
  }

  const title = clip(args.title, MAX_TITLE_CHARS);
  if (!title) return { ok: false, error: "empty_title" };

  // Model dostaje jedną nazwę pola („sections") dla obu formatów — to jego
  // interfejs, nie nasz kształt wewnętrzny. Rozjazd nazw byłby dla niego
  // wyłącznie kolejną okazją do pomyłki.
  const rawSections = Array.isArray(args.sections) ? args.sections : [];
  const blocks: DeckSlide[] = [];
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
    const imageQuery = clip(s.image_query ?? s.imageQuery, MAX_IMAGE_PROMPT_CHARS);
    blocks.push({
      heading: heading || "—",
      content: content || undefined,
      bullets,
      imagePrompt: imagePrompt || undefined,
      imageQuery: imageQuery || undefined,
    });
  }
  if (blocks.length === 0) {
    return { ok: false, error: "empty_sections: provide at least one section with real content" };
  }

  const requestedName = clip(args.filename, 120);
  const base = slugifyFilename((requestedName || title).replace(/\.(pptx|docx|pdf)$/i, ""));
  const subtitle = clip(args.subtitle, MAX_TITLE_CHARS);
  const a = args as Record<string, unknown>;
  const heroImagePrompt = clip(a.hero_image_prompt ?? a.heroImagePrompt, MAX_IMAGE_PROMPT_CHARS);
  const heroImageQuery = clip(a.hero_image_query ?? a.heroImageQuery, MAX_IMAGE_PROMPT_CHARS);

  const common = {
    title,
    subtitle: subtitle || undefined,
    filename: `${base}.${format}`,
    heroImagePrompt: heroImagePrompt || undefined,
    heroImageQuery: heroImageQuery || undefined,
  };

  return {
    ok: true,
    spec:
      format === "pptx"
        ? { format: "pptx", ...common, slides: blocks }
        : { format: "docx", ...common, sections: blocks },
  };
}

/** Czy ten opis w ogóle prosi o jakąkolwiek grafikę? Steruje asynchronicznym
 *  dociąganiem obrazów po oddaniu pliku. */
export function specHasImagePrompts(spec: ProducerSpec): boolean {
  return (
    !!spec.heroImagePrompt ||
    !!spec.heroImageQuery ||
    blocksOf(spec).some((b) => !!b.imagePrompt || !!b.imageQuery)
  );
}
