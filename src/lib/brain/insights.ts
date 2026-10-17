// Mózg 3D — „Wnioski”: co w wiedzy warto uporządkować. Liczone nocą
// (scripts/brain-layout.ts) z prawdziwych embeddingów — przeglądarka
// embeddingów nie dostaje. Czysta logika, bez I/O.
//
// - duplikaty: pary o podobieństwie kosinusowym ≥ DUPLICATE_SIMILARITY —
//   kandydaci do scalenia;
// - samotne gwiazdy: najsłabiej powiązane z resztą (najniższe „najlepsze
//   podobieństwo”) — albo nowy temat, albo coś do dopisania;
// - gromady bez notatki: duże gromady złożone wyłącznie ze wspomnień i
//   dokumentów — kandydat na notatkę-podsumowanie.

import type { BrainSource } from "./layout";

export const DUPLICATE_SIMILARITY = 0.95;
export const MAX_DUPLICATES = 15;
export const MAX_ORPHANS = 8;
/** Samotne = w dolnych 5% „najlepszego podobieństwa” i poniżej tego progu. */
export const ORPHAN_MAX_SIMILARITY = 0.75;
export const ORPHAN_QUANTILE = 0.05;
/** Gromada „bez notatki” liczy się od tylu gwiazd. */
export const CLUSTER_NOTE_MIN = 5;
/** Powyżej tylu gwiazd pary nie są liczone (n² — za drogo dla nocnego joba). */
export const MAX_PAIRWISE = 4000;

type Ref = { type: BrainSource["sourceType"]; id: string; label: string };

export type BrainInsights = {
  duplicates: { a: Ref; b: Ref; similarity: number }[];
  orphans: (Ref & { bestSimilarity: number })[];
  clustersWithoutNote: { cluster: number; size: number }[];
  /** Pary pominięte, bo gwiazd było więcej niż MAX_PAIRWISE. */
  pairwiseSkipped: boolean;
};

const ref = (s: BrainSource): Ref => ({ type: s.sourceType, id: s.sourceId, label: s.label });
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function computeInsights(sources: BrainSource[], assignments: number[]): BrainInsights {
  const n = sources.length;
  const duplicates: BrainInsights["duplicates"] = [];
  const orphans: BrainInsights["orphans"] = [];
  const pairwiseSkipped = n > MAX_PAIRWISE;

  if (n >= 2 && !pairwiseSkipped) {
    const unit = sources.map((s) => {
      const len = Math.hypot(...s.embedding) || 1;
      return s.embedding.map((x) => x / len);
    });
    const best = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const a = unit[i];
      for (let j = i + 1; j < n; j++) {
        const b = unit[j];
        let dot = 0;
        for (let d = 0; d < a.length; d++) dot += a[d] * b[d];
        if (dot > best[i]) best[i] = dot;
        if (dot > best[j]) best[j] = dot;
        if (dot >= DUPLICATE_SIMILARITY) {
          duplicates.push({ a: ref(sources[i]), b: ref(sources[j]), similarity: r3(dot) });
        }
      }
    }
    duplicates.sort((x, y) => y.similarity - x.similarity);
    duplicates.splice(MAX_DUPLICATES);

    if (n >= 10) {
      const sorted = [...best].sort((x, y) => x - y);
      const q = sorted[Math.floor((n - 1) * ORPHAN_QUANTILE)];
      const threshold = Math.min(ORPHAN_MAX_SIMILARITY, q);
      best
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b <= threshold)
        .sort((x, y) => x.b - y.b)
        .slice(0, MAX_ORPHANS)
        .forEach(({ b, i }) => orphans.push({ ...ref(sources[i]), bestSimilarity: r3(b) }));
    }
  }

  const byCluster = new Map<number, { size: number; notes: number }>();
  sources.forEach((s, i) => {
    const c = assignments[i];
    if (c === undefined) return;
    const e = byCluster.get(c) ?? { size: 0, notes: 0 };
    e.size++;
    if (s.sourceType === "note") e.notes++;
    byCluster.set(c, e);
  });
  const clustersWithoutNote = [...byCluster.entries()]
    .filter(([, e]) => e.size >= CLUSTER_NOTE_MIN && e.notes === 0)
    .map(([cluster, e]) => ({ cluster, size: e.size }))
    .sort((a, b) => b.size - a.size);

  return { duplicates, orphans, clustersWithoutNote, pairwiseSkipped };
}

/** Wnioski z meta układu (JSONB) — puste, gdy ich nie ma albo są nieczytelne. */
export function parseInsights(raw: unknown): BrainInsights {
  const empty: BrainInsights = {
    duplicates: [],
    orphans: [],
    clustersWithoutNote: [],
    pairwiseSkipped: false,
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Partial<BrainInsights>;
  return {
    duplicates: Array.isArray(r.duplicates) ? r.duplicates : [],
    orphans: Array.isArray(r.orphans) ? r.orphans : [],
    clustersWithoutNote: Array.isArray(r.clustersWithoutNote) ? r.clustersWithoutNote : [],
    pairwiseSkipped: Boolean(r.pairwiseSkipped),
  };
}
