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

/** Twardy limit zdjęć na plik: 1 tytułowe + do 4 na bloki. Każde to kilka
 *  żądań sieciowych w łańcuchu źródeł, a całość mieści się w budżecie jednego
 *  wywołania w tle — rozbiegany model nie zamówi dwudziestu. */
export const MAX_SECTION_IMAGES = 4;

/** Powyżej czterech liczb na slajdzie nikt już nie czyta — czyta tabelę. */
export const MAX_METRICS = 4;
const MAX_METRIC_VALUE_CHARS = 12;
const MAX_METRIC_LABEL_CHARS = 60;

/** Skąd wziąć zdjęcie dla tego bloku. Wspólne dla slajdu i sekcji dokumentu,
 *  bo potok obrazów jest jeden i nie interesuje go format wyjściowy.
 *
 *  Wyłącznie prawdziwe zdjęcia z sieci — pola na prompt do modelu graficznego
 *  już nie ma. Obraz generowany bywał rozjeżdżoną atrapą tematu, kosztował
 *  płatne żądanie i wracał jako 503 częściej niż jako obraz. */
type ImageRefs = {
  /** Fraza po angielsku do wyszukania zdjęcia. */
  imageQuery?: string;
  /** Adres znalezionego zdjęcia, dopisywany PO fakcie — kiedy potok obrazów
   *  już je znalazł i wbudował w plik. Dzięki temu podgląd pokazuje dokładnie
   *  to zdjęcie, które siedzi w pliku, nie trzymając go drugi raz w storage. */
  imageUrl?: string;
};

/**
 * UKŁADY SLAJDÓW — to jest ta rzecz, której wspólny opis z Wordem nie mógł
 * unieść, i powód, dla którego każda prezentacja wyglądała jak odbitka z
 * jednego szablonu.
 *
 * Model wybiera układ pasujący do treści, a nie współrzędne. Świadoma
 * granica: gdyby podawał `x/y/w/h`, dostałby pełną swobodę i regularnie
 * produkował slajdy z nachodzącym tekstem, bo NIGDY NIE WIDZI swojego
 * wyniku. Skończona lista układów daje mu wybór, a nam gwarancję, że każdy
 * wariant został sprawdzony raz i nie da się go rozsypać.
 *
 * Kolejność ma znaczenie tylko dla czytelności — pierwszy jest domyślny.
 */
export const SLIDE_LAYOUTS = [
  /** Nagłówek + akapit i/lub punkty, opcjonalnie zdjęcie z boku. Koń roboczy. */
  "bullets",
  /** Przekładka: ciemny slajd z numerem i tytułem części. Oddziela rozdziały. */
  "section",
  /** Jedna teza dużym krojem. Bez punktów — slajd ma wybrzmieć, nie streszczać. */
  "statement",
  /** Od jednej do czterech liczb z podpisami. Do wyników, udziałów, skali. */
  "metrics",
  /** Dwie kolumny obok siebie. Do zestawień „przed/po", „my/oni", „za/przeciw". */
  "compare",
  /** Zdjęcie na pełnej szerokości, tytuł na przyciemnieniu. Do otwarć części. */
  "photo",
] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];
export const DEFAULT_LAYOUT: SlideLayout = "bullets";

/** Jedna liczba z podpisem — układ „metrics". */
export type SlideMetric = { value: string; label?: string };

/** Jedna kolumna zestawienia — układ „compare". */
export type SlideColumn = { heading: string; bullets: string[] };

/** Jeden slajd prezentacji. */
export type DeckSlide = ImageRefs & {
  layout: SlideLayout;
  heading: string;
  content?: string;
  bullets?: string[];
  /** Tylko „metrics". */
  metrics?: SlideMetric[];
  /** Tylko „compare" — zawsze dokładnie dwie. */
  columns?: [SlideColumn, SlideColumn];
};

/** Jedna sekcja dokumentu. */
export type DocSection = ImageRefs & {
  heading: string;
  content?: string;
  bullets?: string[];
};

type SpecCommon = {
  title: string;
  subtitle?: string;
  filename: string;
  heroImageQuery?: string;
  heroImageUrl?: string;
};

export type DeckSpec = SpecCommon & { format: "pptx"; slides: DeckSlide[] };
export type DocSpec = SpecCommon & { format: "docx"; sections: DocSection[] };

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

function readMetrics(raw: unknown): SlideMetric[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SlideMetric[] = [];
  // Limit liczony po WALIDACJI, nie przed nią. Obcięcie surowej tablicy z
  // góry sprawiłoby, że jeden pusty wpis od modelu zjada miejsce poprawnej
  // liczbie — slajd „4 wskaźniki" pokazywałby wtedy trzy. Skan i tak jest
  // ograniczony, żeby ogromna tablica nie kosztowała przebiegu.
  for (const item of raw.slice(0, MAX_METRICS * 4)) {
    if (out.length >= MAX_METRICS) break;
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    const value = clip(m.value, MAX_METRIC_VALUE_CHARS);
    if (!value) continue; // liczba bez wartości nie jest liczbą
    out.push({ value, label: clip(m.label, MAX_METRIC_LABEL_CHARS) || undefined });
  }
  return out.length > 0 ? out : undefined;
}

function readColumns(raw: unknown): [SlideColumn, SlideColumn] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SlideColumn[] = [];
  for (const item of raw.slice(0, 2)) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const heading = clip(c.heading, MAX_TITLE_CHARS);
    const bullets = (Array.isArray(c.bullets) ? c.bullets : [])
      .map((b) => clip(b, MAX_BULLET_CHARS))
      .filter(Boolean)
      .slice(0, MAX_BULLETS_PER_SECTION);
    if (!heading && bullets.length === 0) continue;
    out.push({ heading: heading || "—", bullets });
  }
  // Zestawienie z jedną kolumną nie jest zestawieniem — niech spadnie na punkty.
  return out.length === 2 ? [out[0], out[1]] : undefined;
}

/**
 * Wybiera układ i — to jest tu najważniejsze — DEGRADUJE go, gdy brakuje
 * danych, których ten układ wymaga.
 *
 * Model prosi o „metrics", ale nie przysyła ani jednej liczby? Dostaje
 * punkty. Prosi o „compare" z jedną kolumną? Punkty. Bez tego slajd
 * wyrenderowałby się jako pusta ramka z samym nagłówkiem, a użytkownik
 * zobaczyłby dziurę w prezentacji zamiast treści, którą model faktycznie
 * napisał. Renderer może więc zakładać, że dane układu ZAWSZE są na miejscu
 * — nie musi ich sprawdzać drugi raz.
 */
function resolveLayout(
  raw: unknown,
  data: {
    bullets: string[];
    content: string;
    metrics?: SlideMetric[];
    columns?: [SlideColumn, SlideColumn];
    imageQuery: string;
  },
): SlideLayout {
  const asked = String(raw ?? "")
    .trim()
    .toLowerCase() as SlideLayout;
  const layout = SLIDE_LAYOUTS.includes(asked) ? asked : DEFAULT_LAYOUT;

  if (layout === "metrics" && !data.metrics) return DEFAULT_LAYOUT;
  if (layout === "compare" && !data.columns) return DEFAULT_LAYOUT;
  // „photo" bez zdjęcia to czarny prostokąt z tytułem; „statement" bez tekstu
  // to pusty slajd. Oba mają czym oddychać albo schodzą na punkty.
  if (layout === "photo" && !data.imageQuery) return DEFAULT_LAYOUT;
  if (layout === "statement" && !data.content && data.bullets.length === 0) return DEFAULT_LAYOUT;
  return layout;
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
    const metrics = readMetrics(s.metrics);
    const columns = readColumns(s.columns);
    if (!heading && !content && bullets.length === 0 && !metrics && !columns) continue;
    const imageQuery = clip(s.image_query ?? s.imageQuery, MAX_IMAGE_PROMPT_CHARS);
    blocks.push({
      layout: resolveLayout(s.layout, { bullets, content, metrics, columns, imageQuery }),
      heading: heading || "—",
      content: content || undefined,
      bullets,
      metrics,
      columns,
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
  const heroImageQuery = clip(a.hero_image_query ?? a.heroImageQuery, MAX_IMAGE_PROMPT_CHARS);

  const common = {
    title,
    subtitle: subtitle || undefined,
    filename: `${base}.${format}`,
    heroImageQuery: heroImageQuery || undefined,
  };

  if (format === "pptx") return { ok: true, spec: { format: "pptx", ...common, slides: blocks } };

  // Dokument dostaje WYŁĄCZNIE to, co dokument wyraża. Układ, liczby i
  // kolumny to pojęcia slajdu — przepuszczenie ich tutaj tylko dlatego, że
  // wspólna pętla je policzyła, odtworzyłoby dokładnie to sprzęgnięcie
  // formatów, przez które prezentacje były wcześniej kaleke.
  const sections: DocSection[] = blocks.map((b) => ({
    heading: b.heading,
    content: b.content,
    bullets: b.bullets,
    imageQuery: b.imageQuery,
  }));
  return { ok: true, spec: { format: "docx", ...common, sections } };
}

/** Czy ten opis w ogóle prosi o jakiekolwiek zdjęcie? Steruje asynchronicznym
 *  dociąganiem obrazów po oddaniu pliku. */
export function specHasImagePrompts(spec: ProducerSpec): boolean {
  return !!spec.heroImageQuery || blocksOf(spec).some((b) => !!b.imageQuery);
}
