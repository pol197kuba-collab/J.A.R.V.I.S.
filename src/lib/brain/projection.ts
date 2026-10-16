// MÓZG 3D — rzut embeddingów (768 wymiarów) do 3D.
//
// UMAP (umap-js) z odległością kosinusową, czyli tą samą miarą, którą
// liczy pgvector przy wyszukiwaniu (`<=>`): co jest blisko w RAG, jest
// blisko na mapie. Dla bardzo małych zbiorów UMAP nie ma sensu (potrzebuje
// sąsiadów), więc wtedy rzut PCA.
//
// CIEPŁY START: gdy jest wczorajszy układ, UMAP nie zaczyna od losowych
// pozycji, tylko od wczorajszych (nowe gwiazdy — od średniej najbliższych
// znanych sąsiadów) i optymalizuje z mniejszym krokiem. Bez tego jedna nowa
// notatka potrafiła przestawić całą galaktykę (średnie przesunięcie ~0,75
// przy promieniu 1 nawet po wyrównaniu) — gromady „pływałyby” co noc.
//
// Wynik jest deterministyczny (ziarno), wyśrodkowany i przeskalowany tak, że
// 90% gwiazd mieści się w kuli o promieniu 1 — scena skaluje to sama.
// Czysta logika, bez I/O.
import { UMAP } from "umap-js";

export type Vec3 = [number, number, number];

/** Poniżej tylu punktów rzut PCA zamiast UMAP. */
export const MIN_UMAP_POINTS = 8;
const N_NEIGHBORS = 15;
const MIN_DIST = 0.1;
/** Ciepły start: tyle znanych pozycji wystarcza, żeby z nich ruszyć. */
export const MIN_WARM_POINTS = 4;
/** UMAP układa w skali ~±10, nasz zapis — w promieniu ~1. */
const UMAP_SCALE = 10;
const WARM_LEARNING_RATE = 0.2;
const WARM_EPOCHS = 200;
const WARM_NEIGHBORS = 5;

/** Deterministyczny generator liczb losowych (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Odległość kosinusowa (1 − cos), jak `<=>` w pgvector. Własna, bo umap-js
 * ma ją w środku, ale nie eksportuje z pakietu — bez niej UMAP po cichu
 * liczyłby odległość euklidesową.
 */
export function cosineDistance(a: number[], b: number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 1;
  return 1 - ab / Math.sqrt(aa * bb);
}

export function projectTo3d(
  vectors: number[][],
  seed = 42,
  previous: (Vec3 | null)[] = [],
): Vec3[] {
  if (vectors.length === 0) return [];
  if (vectors.length < MIN_UMAP_POINTS) return normalize(pca3(vectors));

  const known = previous.filter(Boolean).length;
  const warm = known >= MIN_WARM_POINTS;
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(N_NEIGHBORS, vectors.length - 1),
    minDist: MIN_DIST,
    distanceFn: cosineDistance,
    random: seededRandom(seed),
    ...(warm ? { learningRate: WARM_LEARNING_RATE, nEpochs: WARM_EPOCHS } : {}),
  });
  if (!warm) return toVec3(umap.fit(vectors));

  const epochs = umap.initializeFit(vectors);
  // Te same tablice czyta optymalizator (head = tail = embedding), więc
  // nadpisanie w miejscu podmienia punkt startowy.
  const embedding = umap.getEmbedding();
  const start = warmStart(vectors, previous, seed);
  for (let i = 0; i < embedding.length; i++) {
    for (let k = 0; k < 3; k++) embedding[i][k] = start[i][k] * UMAP_SCALE;
  }
  for (let e = 0; e < epochs; e++) umap.step();
  return toVec3(umap.getEmbedding());
}

/**
 * Punkt startowy ciepłego startu: wczorajsza pozycja albo — dla nowych
 * gwiazd — średnia pozycji WARM_NEIGHBORS najbliższych (kosinusowo) znanych
 * gwiazd z małym, deterministycznym rozrzutem.
 */
export function warmStart(vectors: number[][], previous: (Vec3 | null)[], seed = 42): Vec3[] {
  const knownIdx = previous.flatMap((p, i) => (p ? [i] : []));
  const rng = seededRandom(seed + 1);
  return vectors.map((v, i) => {
    const prev = previous[i];
    if (prev) return prev;
    const nearest = knownIdx
      .map((j) => ({ j, d: cosineDistance(v, vectors[j]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, WARM_NEIGHBORS);
    const avg: Vec3 = [0, 0, 0];
    for (const { j } of nearest) {
      const p = previous[j]!;
      for (let k = 0; k < 3; k++) avg[k] += p[k] / nearest.length;
    }
    return [
      avg[0] + (rng() - 0.5) * 0.05,
      avg[1] + (rng() - 0.5) * 0.05,
      avg[2] + (rng() - 0.5) * 0.05,
    ];
  });
}

const toVec3 = (raw: number[][]): Vec3[] =>
  normalize(raw.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]));

/** Środek w zerze, 90. percentyl odległości od środka = 1. */
export function normalize(points: Vec3[]): Vec3[] {
  if (points.length === 0) return [];
  const c = centroid(points);
  const centered = points.map((p) => sub(p, c));
  const radii = centered.map(norm).sort((a, b) => a - b);
  const r90 = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.9))];
  const scale = r90 > 1e-9 ? 1 / r90 : 1;
  return centered.map((p) => [p[0] * scale, p[1] * scale, p[2] * scale]);
}

/** Pierwsze trzy składowe główne (iteracja potęgowa z deflacją). */
export function pca3(vectors: number[][]): Vec3[] {
  const n = vectors.length;
  const dims = vectors[0]?.length ?? 0;
  const mean = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let d = 0; d < dims; d++) mean[d] += v[d] / n;
  const X = vectors.map((v) => v.map((x, d) => x - mean[d]));

  const coords: number[][] = vectors.map(() => [0, 0, 0]);
  const components: number[][] = [];
  const rng = seededRandom(7);
  for (let k = 0; k < 3 && k < dims; k++) {
    let w = Array.from({ length: dims }, () => rng() - 0.5);
    for (let iter = 0; iter < 100; iter++) {
      // w ← Xᵀ X w, z usuniętymi wcześniejszymi składowymi.
      const xw = X.map((row) => dot(row, w));
      const next = new Array<number>(dims).fill(0);
      for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) next[d] += X[i][d] * xw[i];
      for (const c of components) {
        const proj = dot(next, c);
        for (let d = 0; d < dims; d++) next[d] -= proj * c[d];
      }
      const len = Math.sqrt(dot(next, next));
      if (len < 1e-12) break;
      w = next.map((x) => x / len);
    }
    components.push(w);
    for (let i = 0; i < n; i++) coords[i][k] = dot(X[i], w);
  }
  return coords.map((c) => [c[0], c[1], c[2]]);
}

// ---------- drobna algebra 3D ----------

export function centroid(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0] / points.length;
    c[1] += p[1] / points.length;
    c[2] += p[2] / points.length;
  }
  return c;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist2 = (a: Vec3, b: Vec3): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
