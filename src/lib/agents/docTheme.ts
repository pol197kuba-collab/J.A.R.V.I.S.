// F.O.R.G.E. — jeden motyw dla wszystkiego, co agent produkuje.
//
// POWÓD ISTNIENIA TEGO PLIKU. Kolory i kroje pisma siedziały dotąd jako luźne
// stałe wewnątrz renderera pptx, a docx miał własne, osobno wpisane. Zmiana
// wyglądu znaczyła więc grzebanie w kodzie układów — czyli w tym samym
// miejscu, gdzie liczone są współrzędne. Tutaj są rozdzielone: ten plik mówi
// CZYM rysujemy, renderery mówią GDZIE.
//
// Celowo bez zależności — ani serwerowych, ani reactowych. Czytają stąd
// wszyscy trzej konsumenci: renderer pptx, renderer docx i podgląd slajdów w
// przeglądarce. To dlatego podgląd w ogóle może wyglądać jak plik: bierze te
// same wartości, a nie ich ręcznie przepisaną kopię.
//
// Wartości są blisko primary HUD-u, żeby wygenerowany plik czytał się jak
// produkt tego systemu, a nie jak coś z zupełnie innej aplikacji.

/** Kolory bez `#` — pptxgenjs i docx wymagają gołego hexa. */
export const DOC_COLORS = {
  /** Akcent: paski, badge'y, linie. */
  accent: "0891B2", // cyan-600
  /** Tło slajdu tytułowego i najciemniejszy tekst. */
  dark: "0F172A", // slate-900
  /** Tekst akapitów i punktów. */
  body: "334155", // slate-700
  /** Matowanie pod zdjęciami, pasy nagłówka/stopki. */
  surface: "F1F5F9", // slate-100
  /** Etykiety, numeracja stron — wszystko, co ma się nie narzucać. */
  muted: "94A3B8", // slate-400
  /** Tło treściowych slajdów i kartki dokumentu. */
  paper: "FFFFFF",
} as const;

/** Z gołego hexa na CSS-owy — dla podglądu w przeglądarce. */
export const cssColor = (hex: string): string => `#${hex}`;

/**
 * Kroje pisma. Nazwy, nie pliki: pptx i docx tylko je REFERENCUJĄ, a glify
 * dokłada program, który otwiera plik. Dlatego oba formaty nie potrzebują
 * żadnego osadzania fontów — w przeciwieństwie do nieistniejącej już ścieżki
 * PDF, gdzie trzeba było wozić ze sobą podzbiór TTF-a, bo wbudowane kroje
 * pdf-liba wywracały się na pierwszym polskim znaku diakrytycznym.
 */
export const DOC_FONTS = {
  heading: "Segoe UI Semibold",
  body: "Segoe UI",
  /** Zapasowy łańcuch dla podglądu w przeglądarce, gdzie Segoe bywa nieobecne. */
  cssStack: '"Segoe UI", system-ui, -apple-system, sans-serif',
} as const;

/** Rozmiary w punktach — wspólna skala dla obu rendererów. */
export const DOC_TYPE_SCALE = {
  deckTitle: 40,
  deckSubtitle: 16,
  slideHeading: 26,
  slideBody: 15,
  docTitle: 32,
  docHeading: 18,
  docBody: 11,
  /** Etykiety, numeracja, chrom. */
  micro: 9,
} as const;

/** Wymiary slajdu w calach — 16:9. Jedno miejsce, bo korzysta z nich i
 *  renderer pptx (współrzędne), i podgląd (proporcje kontenera). */
export const DECK_SLIDE = { width: 13.33, height: 7.5 } as const;
