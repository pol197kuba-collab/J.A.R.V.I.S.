// Szukanie po słowach, gdy nie ma semantyki (brak klucza / embeddingu).
//
// ILIKE na całe pytanie („skąd wie o Marvelu”) prawie nigdy nie trafia —
// w notatce stoi „Marvel”, nie całe zdanie. Tu pytanie rozpada się na
// rdzenie znaczących słów: bez słów-wypełniaczy, z uciętą polską końcówką
// („Marvelu” → „marvel”, „notatkach” → „notatk”), więc „%rdzeń%” łapie
// odmiany. Zwracane są tylko litery i cyfry — bezpieczne dla filtra `or`.

const STOP_WORDS = new Set([
  "skąd",
  "gdzie",
  "kiedy",
  "dlaczego",
  "czemu",
  "który",
  "która",
  "które",
  "jaki",
  "jaka",
  "jakie",
  "czego",
  "kogo",
  "jest",
  "było",
  "była",
  "były",
  "mnie",
  "mojej",
  "moje",
  "mojego",
  "moich",
  "mój",
  "moja",
  "twoje",
  "wiesz",
  "wie",
  "powiedz",
  "sprawdź",
  "pamięci",
  "notatkach",
  "tego",
  "tym",
  "temu",
  "jako",
  "oraz",
  "albo",
  "żeby",
  "about",
  "what",
  "where",
  "when",
  "does",
  "know",
  "jak",
  "czy",
  "dla",
  "się",
  "nie",
  "tak",
  "też",
  "już",
  "ten",
  "ta",
  "co",
  "mam",
  "masz",
  "the",
  "and",
  "how",
  "who",
  "why",
]);

/** Maks. tyle rdzeni — każdy to dwa warunki ILIKE w zapytaniu. */
const MAX_STEMS = 4;

/** Rdzenie znaczących słów pytania, najdłuższe pierwsze. */
export function keywordStems(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const stems = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    // Ucięcie końcówki fleksyjnej; krótkie słowa zostają całe.
    stems.add(w.length > 5 ? w.slice(0, w.length - 2) : w);
  }
  return [...stems].sort((a, b) => b.length - a.length).slice(0, MAX_STEMS);
}

/** Warunek `or` PostgREST: dowolny rdzeń w dowolnej z kolumn. */
export function stemsOrFilter(stems: string[], columns: string[]): string {
  return stems.flatMap((s) => columns.map((c) => `${c}.ilike.%${s}%`)).join(",");
}
