// Darwin — który wariant obsłuży ten bieg. Czysta logika (Thompson sampling).
//
// Champion dostaje stały udział ruchu (CHAMPION_SHARE); resztę dzielą
// pretendenci („active”) wg Thompsona: każdy losuje z rozkładu Beta swoich
// ocen (0..1), wygrywa najwyższe losowanie. Lepszy pretendent dostaje
// więcej szans, ale słaby i mało oceniony też czasem gra — inaczej nie
// dałoby się go poznać. Kandydaci („candidate”) nie grają na żywo: ich
// miejsce to arena (S2.2).

export type LiveStatus = "champion" | "active";

export type Arm = {
  id: string;
  status: LiveStatus;
  /** Liczba ocen. */
  n: number;
  /** Suma ocen (każda 0..1), więc 0 ≤ total ≤ n. */
  total: number;
};

/** Udział championa w ruchu, gdy są też pretendenci. */
export const CHAMPION_SHARE = 0.8;

export type Rng = () => number;

function normal(rng: Rng): number {
  // Box–Muller; 1 - rng() zamiast rng(), żeby nie trafić w log(0).
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(k, 1) — Marsaglia–Tsang; dla k < 1 przez podbicie do k + 1. */
export function sampleGamma(k: number, rng: Rng): number {
  if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(1 - rng(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}

/** Rozkład a posteriori ocen: Beta(1 + suma, 1 + n − suma) — płaski start. */
export function armPosterior(arm: Pick<Arm, "n" | "total">): { a: number; b: number } {
  const n = Math.max(0, arm.n);
  const total = Math.min(n, Math.max(0, arm.total));
  return { a: 1 + total, b: 1 + n - total };
}

/**
 * Id wariantu na ten bieg albo null, gdy agent nie ma wariantów na żywo
 * (wtedy runtime używa zwykłego promptu).
 */
export function pickArm(arms: Arm[], rng: Rng, championShare = CHAMPION_SHARE): string | null {
  if (arms.length === 0) return null;
  const champion = arms.find((a) => a.status === "champion") ?? null;
  const challengers = arms.filter((a) => a.status === "active");
  if (champion && (challengers.length === 0 || rng() < championShare)) return champion.id;
  // Bez championa (np. tuż po wycofaniu) Thompson rozstrzyga między wszystkimi.
  const pool = challengers.length > 0 ? challengers : arms;
  let best: Arm | null = null;
  let bestDraw = -1;
  for (const arm of pool) {
    const { a, b } = armPosterior(arm);
    const draw = sampleBeta(a, b, rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = arm;
    }
  }
  return best?.id ?? null;
}
