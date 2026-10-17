// MÓZG 3D — logika sceny bez three.js: wybór gwiazdy po tapnięciu,
// sąsiedzi, wyszukiwanie, etykiety czasu. Czysta, testowana.

import type { BrainSourceType } from "./layout";

/** Rozmiar galaktyki w scenie: współrzędne z bazy (promień ~1) × SCALE. */
export const SCENE_SCALE = 6;

export type ScreenPoint = { x: number; y: number; visible: boolean };

/**
 * Indeks gwiazdy najbliższej punktowi (px, py) na ekranie, nie dalej niż
 * `tolerance` pikseli — albo null. Własne „trafianie” zamiast raycastera
 * three.js: palec jest szerszy niż kropka, więc tolerancja liczona w
 * pikselach ekranu (np. 28 px na telefonie) trafia tak samo przy każdym
 * przybliżeniu. Przy remisie wygrywa gwiazda bliżej kamery (mniejsza głębia).
 */
export function pickNearest(
  points: ScreenPoint[],
  px: number,
  py: number,
  tolerance: number,
  depths?: number[],
): number | null {
  let best: number | null = null;
  let bestD = tolerance * tolerance;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p.visible) continue;
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d < bestD || (d === bestD && best !== null && depths && depths[i] < depths[best])) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

type Positioned = { x: number; y: number; z: number };

/** k najbliższych (w 3D) gwiazd dla gwiazdy `index`, od najbliższej. */
export function nearestNeighbors(stars: Positioned[], index: number, k: number): number[] {
  const s = stars[index];
  if (!s) return [];
  return stars
    .map((t, i) => ({ i, d: (t.x - s.x) ** 2 + (t.y - s.y) ** 2 + (t.z - s.z) ** 2 }))
    .filter(({ i }) => i !== index)
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(({ i }) => i);
}

/** Małe litery, bez polskich znaków — „łódź” znajduje „Lodz” i odwrotnie. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Wyniki wyszukiwania: każde słowo zapytania musi wystąpić w podpisie albo
 * w nazwie gromady. Wyżej: trafienie od początku słowa, potem waga, potem
 * nowsze. Zwraca indeksy gwiazd.
 */
export function searchStars(
  stars: { label: string; cluster: number | null; weight: number; createdAt: string }[],
  clusterNames: Map<number, string>,
  query: string,
  limit = 20,
): number[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { i: number; score: number; created: string; weight: number }[] = [];
  stars.forEach((s, i) => {
    const label = fold(s.label);
    const cluster = s.cluster === null ? "" : fold(clusterNames.get(s.cluster) ?? "");
    let score = 0;
    for (const w of words) {
      const inLabel = label.indexOf(w);
      if (inLabel >= 0) {
        score += inLabel === 0 || /\s|[^\p{L}\p{N}]/u.test(label[inLabel - 1]) ? 3 : 2;
      } else if (cluster.includes(w)) {
        score += 1;
      } else {
        return;
      }
    }
    scored.push({ i, score, created: s.createdAt, weight: s.weight });
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || b.weight - a.weight || b.created.localeCompare(a.created) || a.i - b.i,
    )
    .slice(0, limit)
    .map((s) => s.i);
}

/** Kropka typu w UI — te same tokeny co gwiazdy w scenie. */
export const TYPE_DOT: Record<BrainSourceType, string> = {
  memory: "bg-reactor",
  note: "bg-success",
  document: "bg-accent",
};

/**
 * Dopisek do pytania zadanego na /mozg — kieruje J.A.R.V.I.S.a do pamięci
 * i notatek zamiast odpowiadania z głowy. Ślad z takim zapytaniem pokazuje
 * się bez dopisku (stripAskPrefix).
 */
export const ASK_PREFIX = "Sprawdź w mojej pamięci i notatkach: ";
export const stripAskPrefix = (q: string): string =>
  q.startsWith(ASK_PREFIX) ? q.slice(ASK_PREFIX.length) : q;

export const TYPE_LABEL: Record<BrainSourceType, string> = {
  memory: "Wspomnienie",
  note: "Notatka",
  document: "Dokument",
};

export const TYPE_LABEL_PLURAL: Record<BrainSourceType, string> = {
  memory: "Wspomnienia",
  note: "Notatki",
  document: "Dokumenty",
};

/** „przed chwilą”, „5 min temu”, „3 godz. temu”, „wczoraj”, „4 dni temu”, potem data. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.floor((now.getTime() - t) / 60_000);
  if (minutes < 1) return "przed chwilą";
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "wczoraj";
  if (days < 30) return `${days} dni temu`;
  return new Date(t).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Świeżość 0–1 do jasności gwiazdy: dzisiejsze świecą najmocniej, po ~90
 * dniach zostaje 35% — stare gwiazdy nie gasną, tylko ustępują nowym.
 */
export function freshness(iso: string, now: Date = new Date()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0.35;
  const days = Math.max(0, (now.getTime() - t) / 86_400_000);
  return 0.35 + 0.65 * Math.exp(-days / 30);
}
