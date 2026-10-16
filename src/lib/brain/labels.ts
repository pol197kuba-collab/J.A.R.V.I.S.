// MÓZG 3D — nazwy gromad.
//
// Dwie drogi, jak wszędzie w J.A.R.V.I.S.ie: model nazywa gromady, gdy jest
// klucz, a bez klucza (albo gdy odpowiedź jest nie do użycia) nazwa powstaje
// ze słów, które w danej gromadzie są częste, a w pozostałych rzadkie
// (TF-IDF po gromadach). Nazwa ze słów jest uboższa, ale zawsze prawdziwa —
// zbudowana wyłącznie z podpisów gwiazd. Czysta logika, bez I/O.

const STOPWORDS = new Set(
  // polskie
  (
    "oraz albo lub ale czy jak jest są był była było być będzie się nie tak też już " +
    "dla przez przy pod nad bez od do na w z ze o u za po co to ten ta te tego tej " +
    "jego jej ich mój moja moje twój nasz wasz który która które jaki jaka jakie " +
    "żeby aby gdy kiedy gdzie tylko jeszcze bardzo może można trzeba mam masz " +
    // angielskie
    "the and for with from that this are was were have has had not but you your " +
    "into about over under what when where which who will would can could should " +
    // techniczne końcówki plików
    "pdf docx doc txt pptx xlsx csv md png jpg jpeg"
  ).split(/\s+/),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/** `labelsByCluster[c]` = podpisy gwiazd gromady c. Zwraca nazwę dla każdej gromady. */
export function keywordClusterNames(labelsByCluster: string[][]): string[] {
  const k = labelsByCluster.length;
  const tf = labelsByCluster.map((labels) => {
    const counts = new Map<string, number>();
    for (const label of labels) {
      // Słowo liczone raz na gwiazdę — jeden długi podpis nie zdominuje gromady.
      for (const w of new Set(tokenize(label))) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return counts;
  });
  const df = new Map<string, number>();
  for (const counts of tf) for (const w of counts.keys()) df.set(w, (df.get(w) ?? 0) + 1);

  return tf.map((counts, c) => {
    const scored = [...counts.entries()]
      // Słowo z jednej gwiazdy to przypadek, nie temat — chyba że gromada jest mała.
      .filter(([, n]) => n >= 2 || labelsByCluster[c].length <= 3)
      // Słowo obecne we WSZYSTKICH gromadach nic nie odróżnia (idf = 0) —
      // inaczej każda gromada dostałaby tę samą nazwę.
      .map(([w, n]) => ({ w, score: n * (k === 1 ? 1 : Math.log(k / (df.get(w) ?? 1))) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));
    const words = scored.slice(0, 2).map((s) => s.w);
    if (words.length === 0) return `Gromada ${c + 1}`;
    return words.map(capitalize).join(" · ");
  });
}

const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

// ---------- nazwy od modelu ----------

/** Ile podpisów z gromady trafia do promptu — reszta i tak niewiele zmienia. */
export const NAMING_SAMPLE = 12;
export const MAX_NAME_LENGTH = 40;

export const CLUSTER_NAMING_SYSTEM =
  "Nazywasz gromady tematyczne w osobistej bazie wiedzy. Dla każdej gromady dostajesz " +
  "podpisy jej elementów (notatki, wspomnienia, dokumenty). Zwróć krótką nazwę tematu " +
  "po polsku: 1–3 słowa, bez cudzysłowów, bez numerów, bez słowa „gromada”. " +
  'Odpowiedz WYŁĄCZNIE tablicą JSON: [{"id": 0, "name": "..."}, ...].';

export function buildClusterNamingPrompt(labelsByCluster: string[][]): string {
  return labelsByCluster
    .map((labels, id) => {
      const sample = labels.slice(0, NAMING_SAMPLE).map((l) => `- ${l.slice(0, 100)}`);
      return `Gromada ${id} (${labels.length} el.):\n${sample.join("\n")}`;
    })
    .join("\n\n");
}

/** Nazwy z odpowiedzi modelu; null tam, gdzie nazwa brakuje albo jest nie do użycia. */
export function parseClusterNames(text: string, count: number): (string | null)[] {
  const out = new Array<string | null>(count).fill(null);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { id, name } = item as { id?: unknown; name?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id >= count) continue;
    if (typeof name !== "string") continue;
    const clean = name
      .replace(/["„”«»]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || clean.length > MAX_NAME_LENGTH) continue;
    out[id] = clean;
  }
  return out;
}
