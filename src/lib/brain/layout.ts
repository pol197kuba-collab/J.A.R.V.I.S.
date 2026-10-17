// MÓZG 3D — pełny układ: źródła → rzut 3D → wyrównanie do wczoraj → gromady
// → nazwy ze słów. Nazwy od modelu nakłada skrypt (to jedyny krok z I/O).
// Czysta logika, bez I/O — ten sam układ da się policzyć w teście.
import { alignToPrevious } from "./align";
import { chooseClusterCount, kMeans } from "./clusters";
import { keywordClusterNames } from "./labels";
import { projectTo3d, type Vec3 } from "./projection";

export type BrainSourceType = "memory" | "note" | "document";

export type BrainSource = {
  sourceType: BrainSourceType;
  sourceId: string;
  label: string;
  embedding: number[];
  weight: number;
  sourceCreatedAt: string;
};

export type LayoutPoint = {
  source_type: BrainSourceType;
  source_id: string;
  x: number;
  y: number;
  z: number;
  cluster_id: number;
  label: string;
  weight: number;
  source_created_at: string;
};

export type LayoutCluster = {
  cluster_id: number;
  name: string;
  named_by: "keywords" | "model";
  x: number;
  y: number;
  z: number;
};

export type BrainLayout = {
  points: LayoutPoint[];
  clusters: LayoutCluster[];
  /** Do brain_layout_runs.meta — co się stało w tym przebiegu. */
  meta: { aligned: boolean; mirrored: boolean; alignRms: number | null; reused: number };
  /** Podpisy per gromada — do promptu nazywającego. */
  labelsByCluster: string[][];
};

export const sourceKey = (type: string, id: string): string => `${type}:${id}`;

/** Zaokrąglenie do zapisu — 4 miejsca wystarczą przy promieniu ~1. */
const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

export function computeBrainLayout(
  sources: BrainSource[],
  previous: Map<string, Vec3>,
  seed = 42,
): BrainLayout {
  const prev = sources.map((s) => previous.get(sourceKey(s.sourceType, s.sourceId)) ?? null);
  // Ciepły start od wczorajszych pozycji, a potem jeszcze sztywne wyrównanie
  // — ciepły start trzyma kształt, wyrównanie domyka skalę i przesunięcie.
  const projected = projectTo3d(
    sources.map((s) => s.embedding),
    seed,
    prev,
  );
  const aligned = alignToPrevious(projected, prev);

  const { assignments, centroids } = kMeans(
    aligned.points,
    chooseClusterCount(sources.length),
    seed,
  );
  const labelsByCluster = centroids.map(() => [] as string[]);
  sources.forEach((s, i) => labelsByCluster[assignments[i]]?.push(s.label));
  const names = keywordClusterNames(labelsByCluster);

  return {
    points: sources.map((s, i) => {
      const [x, y, z] = aligned.points[i];
      return {
        source_type: s.sourceType,
        source_id: s.sourceId,
        x: r4(x),
        y: r4(y),
        z: r4(z),
        cluster_id: assignments[i],
        label: s.label,
        weight: s.weight,
        source_created_at: s.sourceCreatedAt,
      };
    }),
    clusters: centroids.map(([x, y, z], c) => ({
      cluster_id: c,
      name: names[c],
      named_by: "keywords",
      x: r4(x),
      y: r4(y),
      z: r4(z),
    })),
    meta: {
      aligned: aligned.aligned,
      mirrored: aligned.mirrored,
      alignRms: Number.isFinite(aligned.rms) ? r4(aligned.rms) : null,
      reused: prev.filter(Boolean).length,
    },
    labelsByCluster,
  };
}

/** Nakłada nazwy od modelu tam, gdzie są; reszta zostaje przy słowach kluczowych. */
export function applyModelNames(
  clusters: LayoutCluster[],
  modelNames: (string | null)[],
): LayoutCluster[] {
  return clusters.map((c) => {
    const name = modelNames[c.cluster_id];
    return name ? { ...c, name, named_by: "model" } : c;
  });
}
