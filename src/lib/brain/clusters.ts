// MÓZG 3D — gromady tematów: k-średnich na współrzędnych 3D po UMAP.
//
// Na współrzędnych z rzutu, nie na 768 wymiarach: UMAP już zebrał podobne
// rzeczy w skupiska, a gromada ma się zgadzać z tym, co użytkownik WIDZI.
// Numeracja gromad od największej (0 = najliczniejsza), żeby kolory i
// legenda były stabilne między przebiegami tak bardzo, jak się da.
// Czysta logika, bez I/O.
import { centroid, dist2, seededRandom, type Vec3 } from "./projection";

export const MAX_CLUSTERS = 12;

/** Ile gromad dla n gwiazd: ~√(n/4), od 2 do MAX_CLUSTERS; poniżej 6 gwiazd jedna. */
export function chooseClusterCount(n: number): number {
  if (n < 6) return n === 0 ? 0 : 1;
  return Math.max(2, Math.min(MAX_CLUSTERS, Math.round(Math.sqrt(n / 4))));
}

export type Clustering = { assignments: number[]; centroids: Vec3[] };

export function kMeans(points: Vec3[], k: number, seed = 42): Clustering {
  if (points.length === 0 || k <= 0) return { assignments: [], centroids: [] };
  k = Math.min(k, points.length);
  const rng = seededRandom(seed);

  // k-means++: kolejne środki losowane z prawdopodobieństwem ∝ odległości².
  const centers: Vec3[] = [points[Math.floor(rng() * points.length)]];
  while (centers.length < k) {
    const d = points.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const total = d.reduce((s, x) => s + x, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    while (idx < d.length - 1 && r >= d[idx]) {
      r -= d[idx];
      idx++;
    }
    centers.push(points[idx]);
  }

  let assignments = new Array<number>(points.length).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const next = points.map((p) => nearest(p, centers));
    const changed = next.some((a, i) => a !== assignments[i]);
    assignments = next;
    for (let c = 0; c < centers.length; c++) {
      const members = points.filter((_, i) => assignments[i] === c);
      if (members.length > 0) centers[c] = centroid(members);
    }
    if (!changed && iter > 0) break;
  }

  // Pusta gromada (możliwa przy powtórzonych punktach) — wypada.
  const sizes = centers.map((_, c) => assignments.filter((a) => a === c).length);
  const order = centers
    .map((_, c) => c)
    .filter((c) => sizes[c] > 0)
    .sort((a, b) => sizes[b] - sizes[a] || a - b);
  const remap = new Map(order.map((c, i) => [c, i]));
  return {
    assignments: assignments.map((a) => remap.get(a) ?? 0),
    centroids: order.map((c) => centers[c]),
  };
}

function nearest(p: Vec3, centers: Vec3[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < centers.length; c++) {
    const d = dist2(p, centers[c]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
