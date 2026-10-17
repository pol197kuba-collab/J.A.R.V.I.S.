// MÓZG 3D — nowy układ nakładany na wczorajszy.
//
// UMAP liczony od nowa każdej nocy daje tę samą „galaktykę", ale dowolnie
// obróconą, przesuniętą i często lustrzaną. Bez wyrównania użytkownik co
// rano szukałby swoich gromad od nowa. Dlatego nowe współrzędne są
// dopasowywane do poprzednich (przekształcenie podobieństwa: obrót, odbicie,
// skala, przesunięcie) na podstawie gwiazd obecnych w obu układach.
//
// Obrót: metoda kwaternionów Horna (1987) — największy wektor własny
// symetrycznej macierzy 4×4, liczony metodą Jacobiego. Odbicie: liczymy
// dopasowanie dla układu oryginalnego i lustrzanego, wygrywa mniejszy błąd.
// Czysta logika, bez I/O.
import { centroid, sub, type Vec3 } from "./projection";

/** Poniżej tylu wspólnych gwiazd nie wyrównujemy — za mało, by wierzyć. */
export const MIN_ALIGN_PAIRS = 4;

export type AlignResult = { points: Vec3[]; aligned: boolean; mirrored: boolean; rms: number };

/**
 * `next[i]` i `prev[i]` to ta sama gwiazda; `prev[i] === null`, gdy gwiazdy
 * wczoraj nie było. Zwraca wszystkie punkty `next` po przekształceniu.
 */
export function alignToPrevious(next: Vec3[], prev: (Vec3 | null)[]): AlignResult {
  const pairs: [Vec3, Vec3][] = [];
  next.forEach((p, i) => {
    const q = prev[i];
    if (q) pairs.push([p, q]);
  });
  if (pairs.length < MIN_ALIGN_PAIRS) {
    return { points: next, aligned: false, mirrored: false, rms: Number.NaN };
  }

  const plain = fitSimilarity(pairs);
  const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
  const mirrored = fitSimilarity(pairs.map(([a, b]) => [mirror(a), b]));
  const useMirror = mirrored.rms < plain.rms;
  const fit = useMirror ? mirrored : plain;
  const points = next.map((p) => fit.apply(useMirror ? mirror(p) : p));
  return { points, aligned: true, mirrored: useMirror, rms: fit.rms };
}

type SimilarityFit = { apply: (p: Vec3) => Vec3; rms: number };

function fitSimilarity(pairs: [Vec3, Vec3][]): SimilarityFit {
  const ca = centroid(pairs.map(([a]) => a));
  const cb = centroid(pairs.map(([, b]) => b));
  const A = pairs.map(([a]) => sub(a, ca));
  const B = pairs.map(([, b]) => sub(b, cb));

  // S = Σ a bᵀ
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < A.length; i++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[i][r] * B[i][c];
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = largestEigenvector4(N);
  const R = quaternionToMatrix(q);

  const sumA = A.reduce((s, a) => s + a[0] ** 2 + a[1] ** 2 + a[2] ** 2, 0);
  const sumB = B.reduce((s, b) => s + b[0] ** 2 + b[1] ** 2 + b[2] ** 2, 0);
  const scale = sumA > 1e-12 ? Math.sqrt(sumB / sumA) : 1;

  const apply = (p: Vec3): Vec3 => {
    const d = sub(p, ca);
    const r = mulMatVec(R, d);
    return [cb[0] + scale * r[0], cb[1] + scale * r[1], cb[2] + scale * r[2]];
  };
  let err = 0;
  for (const [a, b] of pairs) {
    const m = apply(a);
    err += (m[0] - b[0]) ** 2 + (m[1] - b[1]) ** 2 + (m[2] - b[2]) ** 2;
  }
  return { apply, rms: Math.sqrt(err / pairs.length) };
}

/** Wektor własny dla największej wartości własnej (macierz symetryczna 4×4, Jacobi). */
export function largestEigenvector4(M: number[][]): number[] {
  const a = M.map((row) => [...row]);
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

function quaternionToMatrix([w, x, y, z]: number[]): number[][] {
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n;
  x /= n;
  y /= n;
  z /= n;
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
}

const mulMatVec = (m: number[][], v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
