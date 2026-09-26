// CZY TO ZDJĘCIE JEST W OGÓLE O TYM, O CO PROSILIŚMY.
//
// POWÓD ISTNIENIA. Potok zdjęć brał PIERWSZY wynik każdej warstwy i wklejał
// go do slajdu bez jednego pytania: czy to na pewno przedstawia temat.
// Efekt na żywo (prezentacja o GTA VI, 26 września): plakat „Scarface" z
// 1932 roku na slajdzie o bohaterach, parking z lat 50. na slajdzie o Vice
// City, rafa koralowa na slajdzie o świecie gry. Każde z tych zdjęć było
// poprawnie pobrane, w dobrej rozdzielczości i kompletnie nie na temat.
//
// Wyszukiwarki ZAWSZE coś zwrócą. Dla tematu chronionego prawem autorskim
// (gra, film, produkt) archiwa na wolnych licencjach nie mają nic — więc
// oddają to, co najbliżej pasuje słowami, czyli przypadek. Dla zapytania
// „Rockstar Games logo office" Wikipedia zwróciła artykuł „Rockstar Leeds":
// inne studio, inne miasto. Gdyby miał zdjęcie, wylądowałoby na slajdzie.
//
// ZASADA: SLAJD BEZ ZDJĘCIA JEST LEPSZY NIŻ SLAJD ZE ZŁYM ZDJĘCIEM. Pusty
// slajd wygląda na świadomy wybór. Slajd z plakatem „Scarface" pod
// nagłówkiem o Lucii i Jasonie wygląda na pomyłkę — i podważa zaufanie do
// całej reszty, łącznie z treścią, która akurat była dobra.

/** Słowa, które nie niosą tematu i nie mają prawa decydować o dopasowaniu. */
const STOPWORDS = new Set([
  // polskie
  "i",
  "oraz",
  "w",
  "we",
  "na",
  "do",
  "od",
  "z",
  "ze",
  "za",
  "po",
  "o",
  "u",
  "dla",
  "przy",
  "pod",
  "nad",
  "the",
  "a",
  "an",
  // angielskie
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "and",
  "or",
  "with",
  "by",
  "from",
]);

/** Ogonki na gołe litery — „Sławiński" i „Slawinski" mają się zgadzać. */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
}

/** Słowa znaczące: bez ogonków, bez interpunkcji, bez spójników i skrótów. */
export function meaningfulTokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Ile słów zapytania musi znaleźć się w opisie kandydata.
 *
 * Połowa, zaokrąglona w górę. Niżej przepuszcza przypadek: „Rockstar Games
 * logo office" kontra „Rockstar Leeds" to jedno słowo z czterech i ma
 * odpaść. Wyżej odrzuca trafienia poprawne: „2015 Dodge Charger" kontra
 * „2015 Dodge Charger SRT Hellcat: Iron Lion from Zion" musi przejść, a
 * tytuły z archiwów prawie zawsze mają słowa nadmiarowe.
 */
const REQUIRED_SHARE = 0.5;

/**
 * Czy opis kandydata (tytuł artykułu, tytuł zdjęcia, tytuł strony) mówi o
 * tym samym, co zapytanie.
 *
 * Bez opisu ODPOWIEDŹ BRZMI NIE. Warstwa, która nie potrafi powiedzieć, co
 * znalazła, nie daje się sprawdzić — a niesprawdzone zdjęcie to dokładnie
 * ten przypadek, przez który powstał ten plik.
 */
export function isOnTopic(query: string, candidateText: string | null | undefined): boolean {
  if (!candidateText) return false;
  const wanted = meaningfulTokens(query);
  if (wanted.length === 0) return false;

  const found = new Set(meaningfulTokens(candidateText));
  // Dopasowanie po RDZENIU, nie po dokładnym słowie: polska odmiana
  // („Warszawa" / „warszawski") i angielska liczba mnoga rozjechałyby się
  // przy porównaniu jeden do jednego.
  const hits = wanted.filter((w) =>
    [...found].some((f) => f === w || (w.length >= 5 && (f.startsWith(w) || w.startsWith(f)))),
  ).length;

  return hits >= Math.ceil(wanted.length * REQUIRED_SHARE);
}
