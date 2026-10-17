import { describe, expect, it } from "vitest";
import { alignToPrevious, MIN_ALIGN_PAIRS } from "./align";
import { chooseClusterCount, kMeans } from "./clusters";
import {
  buildClusterNamingPrompt,
  keywordClusterNames,
  parseClusterNames,
  tokenize,
} from "./labels";
import { applyModelNames, computeBrainLayout, sourceKey, type BrainSource } from "./layout";
import {
  cosineDistance,
  norm,
  normalize,
  pca3,
  projectTo3d,
  seededRandom,
  warmStart,
  type Vec3,
} from "./projection";
import { noteEmbeddingText, parseVectorLiteral, toVectorLiteral } from "@/lib/ai/embed";

const DIMS = 768;

/** Wektor wokół jednego z kilku „tematów": oś tematu + mały szum. */
function topicVector(topic: number, rng: () => number): number[] {
  const v = Array.from({ length: DIMS }, () => (rng() - 0.5) * 0.15);
  for (let d = topic * 40; d < topic * 40 + 40; d++) v[d] += 1;
  return v;
}

function sources(perTopic: number[], seed = 1): BrainSource[] {
  const rng = seededRandom(seed);
  const topicWords = ["giełda akcje", "paliwo stacja", "pies spacer"];
  const out: BrainSource[] = [];
  perTopic.forEach((count, topic) => {
    for (let i = 0; i < count; i++) {
      out.push({
        sourceType: "note",
        sourceId: `t${topic}-${i}`,
        label: `${topicWords[topic]} ${i}`,
        embedding: topicVector(topic, rng),
        weight: 3,
        sourceCreatedAt: "2026-10-01T00:00:00Z",
      });
    }
  });
  return out;
}

const rotateZ = (p: Vec3, angle: number): Vec3 => [
  p[0] * Math.cos(angle) - p[1] * Math.sin(angle),
  p[0] * Math.sin(angle) + p[1] * Math.cos(angle),
  p[2],
];

describe("projectTo3d", () => {
  it("rozdziela trzy tematy: gwiazdy z jednego tematu są bliżej siebie niż obcych", () => {
    const src = sources([15, 15, 15]);
    const pts = projectTo3d(src.map((s) => s.embedding));
    expect(pts).toHaveLength(45);
    const topic = (i: number) => Math.floor(i / 15);
    let same = 0;
    let other = 0;
    let nSame = 0;
    let nOther = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = norm([pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]]);
        if (topic(i) === topic(j)) {
          same += d;
          nSame++;
        } else {
          other += d;
          nOther++;
        }
      }
    }
    expect(same / nSame).toBeLessThan((other / nOther) * 0.5);
  });

  it("odległość kosinusowa: kierunek się liczy, długość nie", () => {
    expect(cosineDistance([1, 0], [5, 0])).toBeCloseTo(0, 12);
    expect(cosineDistance([1, 0], [0, 3])).toBeCloseTo(1, 12);
    expect(cosineDistance([1, 0], [-2, 0])).toBeCloseTo(2, 12);
    expect(cosineDistance([0, 0], [1, 0])).toBe(1);
  });

  it("jest deterministyczny przy tym samym ziarnie", () => {
    const vectors = sources([10, 10]).map((s) => s.embedding);
    expect(projectTo3d(vectors, 7)).toEqual(projectTo3d(vectors, 7));
  });

  it("dla małych zbiorów (PCA) i pustego wejścia nie wybucha", () => {
    expect(projectTo3d([])).toEqual([]);
    const small = projectTo3d(sources([2, 2]).map((s) => s.embedding));
    expect(small).toHaveLength(4);
    for (const p of small) for (const x of p) expect(Number.isFinite(x)).toBe(true);
    expect(projectTo3d([new Array(DIMS).fill(0)])).toEqual([[0, 0, 0]]);
  });

  it("normalizuje: środek w zerze, 90% gwiazd w kuli o promieniu ~1", () => {
    const pts = normalize([
      [10, 10, 10],
      [12, 10, 10],
      [10, 14, 10],
      [10, 10, 16],
    ]);
    const c = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    for (const x of c) expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(Math.max(...pts.map(norm))).toBeCloseTo(1, 6);
  });

  it("PCA: pierwsza oś to kierunek największej zmienności", () => {
    const pts = pca3([
      [0, 0, 0],
      [10, 0.1, 0],
      [20, -0.1, 0],
      [30, 0, 0.1],
    ]);
    const spread = (k: number) =>
      Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
    expect(spread(0)).toBeGreaterThan(spread(1) * 50);
  });
});

describe("warmStart", () => {
  it("znane gwiazdy zostają na miejscu, nowa startuje przy najbliższych sąsiadach", () => {
    // Sześć znanych gwiazd w kierunku [1, 0] (na mapie po prawej), dwie w
    // kierunku [0, 1] (po lewej); nowa gwiazda jest kierunkowo „prawa”.
    const right = Array.from({ length: 6 }, (_, i) => [1, i * 0.01]);
    const left = [
      [0, 1],
      [0.01, 1],
    ];
    const vectors = [...right, ...left, [1, 0.02]];
    const prev: (Vec3 | null)[] = [
      ...right.map((_, i) => [5, i * 0.1, 0] as Vec3),
      [-5, 0, 0],
      [-5, 0.1, 0],
      null,
    ];
    const start = warmStart(vectors, prev);
    expect(start.slice(0, 8)).toEqual(prev.slice(0, 8));
    expect(start[8][0]).toBeCloseTo(5, 1);
  });
});

describe("alignToPrevious", () => {
  const base: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
    [1, 1, 1],
    [-1, 0.5, 2],
  ];

  it("odtwarza obrót, skalę i przesunięcie", () => {
    const moved = base.map((p) => {
      const r = rotateZ(p, 1.1);
      return [r[0] * 2.5 + 4, r[1] * 2.5 - 1, r[2] * 2.5 + 7] as Vec3;
    });
    const res = alignToPrevious(moved, base);
    expect(res.aligned).toBe(true);
    expect(res.mirrored).toBe(false);
    res.points.forEach((p, i) => p.forEach((x, k) => expect(x).toBeCloseTo(base[i][k], 6)));
  });

  it("rozpoznaje odbicie lustrzane (UMAP potrafi odwrócić galaktykę)", () => {
    const mirrored = base.map(([x, y, z]) => rotateZ([-x, y, z], 0.4));
    const res = alignToPrevious(mirrored, base);
    expect(res.mirrored).toBe(true);
    res.points.forEach((p, i) => p.forEach((x, k) => expect(x).toBeCloseTo(base[i][k], 6)));
  });

  it("nowe gwiazdy (bez wczorajszej pozycji) jadą razem z resztą", () => {
    const prev: (Vec3 | null)[] = [...base, null];
    const extra: Vec3 = [2, 2, 2];
    const moved = [...base, extra].map((p) => rotateZ(p, 2) as Vec3);
    const res = alignToPrevious(moved, prev);
    res.points[6].forEach((x, k) => expect(x).toBeCloseTo(extra[k], 6));
  });

  it(`poniżej ${MIN_ALIGN_PAIRS} wspólnych gwiazd zostawia układ bez zmian`, () => {
    const moved = base.map((p) => rotateZ(p, 1));
    const res = alignToPrevious(moved, [base[0], base[1], null, null, null, null]);
    expect(res.aligned).toBe(false);
    expect(res.points).toBe(moved);
  });
});

describe("kMeans", () => {
  it("liczba gromad rośnie z liczbą gwiazd, w granicach 1–12", () => {
    expect(chooseClusterCount(0)).toBe(0);
    expect(chooseClusterCount(3)).toBe(1);
    expect(chooseClusterCount(20)).toBe(3);
    expect(chooseClusterCount(75)).toBe(6);
    expect(chooseClusterCount(200)).toBe(10);
    expect(chooseClusterCount(50_000)).toBe(12);
  });

  it("znajduje dwa skupiska i numeruje od największego", () => {
    const pts: Vec3[] = [
      ...Array.from({ length: 3 }, (_, i) => [10 + i * 0.1, 0, 0] as Vec3),
      ...Array.from({ length: 7 }, (_, i) => [0, i * 0.1, 0] as Vec3),
    ];
    const { assignments, centroids } = kMeans(pts, 2);
    expect(centroids).toHaveLength(2);
    expect(assignments.slice(3).every((a) => a === 0)).toBe(true);
    expect(assignments.slice(0, 3).every((a) => a === 1)).toBe(true);
  });

  it("powtórzone punkty nie zostawiają pustej gromady", () => {
    const pts: Vec3[] = Array.from({ length: 5 }, () => [1, 1, 1]);
    const { assignments, centroids } = kMeans(pts, 3);
    expect(centroids.length).toBe(1);
    expect(new Set(assignments)).toEqual(new Set([0]));
  });
});

describe("nazwy gromad", () => {
  it("tokenize: polskie znaki, bez krótkich słów i stopwords", () => {
    expect(tokenize("Ceny paliw na stacjach w Łodzi — raport.pdf")).toEqual([
      "ceny",
      "paliw",
      "stacjach",
      "łodzi",
      "raport",
    ]);
  });

  it("słowa kluczowe: częste w gromadzie, rzadkie w innych", () => {
    const names = keywordClusterNames([
      ["Kurs akcji CDR", "Akcje PKN dywidenda", "Portfel akcji"],
      ["Spacer z Marvelem", "Marvel u weterynarza", "Karma dla Marvela"],
      ["xyz"],
    ]);
    expect(names[0]).toMatch(/^Akcji|^Akcje/);
    expect(names[1]).toContain("Marvel");
    expect(names[2]).toBe("Xyz");
  });

  it("słowo wspólne dla wszystkich gromad nie jest nazwą", () => {
    const names = keywordClusterNames([
      ["temat akcje", "temat akcje"],
      ["temat paliwo", "temat paliwo"],
      ["temat", "temat"],
    ]);
    expect(names).toEqual(["Akcje", "Paliwo", "Gromada 3"]);
  });

  it("bez żadnego słowa — numer gromady", () => {
    expect(keywordClusterNames([["a b", "12 34"]])).toEqual(["Gromada 1"]);
  });

  it("parseClusterNames: bierze poprawne, odrzuca śmieci, zna granice", () => {
    const text =
      'Oto nazwy:\n[{"id":0,"name":"„Inwestycje”"},{"id":1,"name":""},{"id":5,"name":"X"},' +
      `{"id":2,"name":"${"a".repeat(60)}"},{"id":1.5,"name":"Y"}]`;
    expect(parseClusterNames(text, 3)).toEqual(["Inwestycje", null, null]);
    expect(parseClusterNames("nie wiem", 2)).toEqual([null, null]);
    expect(parseClusterNames("[{]", 1)).toEqual([null]);
  });

  it("prompt zawiera próbkę podpisów i liczność gromady", () => {
    const prompt = buildClusterNamingPrompt([["a", "b"], ["c"]]);
    expect(prompt).toContain("Gromada 0 (2 el.)");
    expect(prompt).toContain("- c");
  });
});

describe("computeBrainLayout", () => {
  it("składa gwiazdy, gromady i nazwy; drugi przebieg ląduje na pierwszym", () => {
    const src = sources([12, 12, 12]);
    const first = computeBrainLayout(src, new Map(), 1);
    expect(first.points).toHaveLength(36);
    expect(first.meta.aligned).toBe(false);
    expect(first.clusters.length).toBe(chooseClusterCount(36));
    expect(first.labelsByCluster.flat()).toHaveLength(36);

    // Inne ziarno = inaczej obrócona galaktyka; wyrównanie ma ją sprowadzić
    // z powrotem w okolice wczorajszych pozycji.
    const previous = new Map(
      first.points.map((p) => [sourceKey(p.source_type, p.source_id), [p.x, p.y, p.z] as Vec3]),
    );
    const second = computeBrainLayout(src, previous, 99);
    expect(second.meta.aligned).toBe(true);
    expect(second.meta.reused).toBe(36);
    const drift =
      second.points.reduce((s, p, i) => {
        const q = first.points[i];
        return s + norm([p.x - q.x, p.y - q.y, p.z - q.z]);
      }, 0) / 36;
    expect(drift).toBeLessThan(0.6);
  });

  it("jedna nowa gwiazda nie przestawia galaktyki (ciepły start)", () => {
    const src = sources([20, 20, 20], 5);
    const first = computeBrainLayout(src, new Map(), 3);
    const previous = new Map(
      first.points.map((p) => [sourceKey(p.source_type, p.source_id), [p.x, p.y, p.z] as Vec3]),
    );
    const rng = seededRandom(77);
    const extra: BrainSource = { ...src[0], sourceId: "nowa", embedding: topicVector(1, rng) };
    const second = computeBrainLayout([...src, extra], previous, 3);
    const drift =
      first.points.reduce((s, p, i) => {
        const q = second.points[i];
        return s + norm([p.x - q.x, p.y - q.y, p.z - q.z]);
      }, 0) / first.points.length;
    expect(drift).toBeLessThan(0.15);
    // Nowa gwiazda ląduje przy swoim temacie (gwiazdy 20–39), nie gdzieś w próżni.
    const added = second.points[60];
    const nearestIdx = second.points
      .slice(0, 60)
      .map((p, i) => ({ i, d: norm([p.x - added.x, p.y - added.y, p.z - added.z]) }))
      .sort((a, b) => a.d - b.d)[0].i;
    expect(Math.floor(nearestIdx / 20)).toBe(1);
  });

  it("nazwy od modelu nadpisują tylko te gromady, dla których przyszły", () => {
    const clusters = [
      { cluster_id: 0, name: "Akcje", named_by: "keywords" as const, x: 0, y: 0, z: 0 },
      { cluster_id: 1, name: "Pies", named_by: "keywords" as const, x: 1, y: 0, z: 0 },
    ];
    const named = applyModelNames(clusters, ["Inwestycje", null]);
    expect(named[0]).toMatchObject({ name: "Inwestycje", named_by: "model" });
    expect(named[1]).toMatchObject({ name: "Pies", named_by: "keywords" });
  });
});

describe("embed helpers", () => {
  it("wektor przechodzi w obie strony; zły format daje null", () => {
    const v = Array.from({ length: DIMS }, (_, i) => i / DIMS);
    expect(parseVectorLiteral(toVectorLiteral(v))).toEqual(v);
    expect(parseVectorLiteral(v)).toEqual(v);
    expect(parseVectorLiteral("[1,2,3]")).toBeNull();
    expect(parseVectorLiteral("nie wektor")).toBeNull();
    expect(parseVectorLiteral(null)).toBeNull();
  });

  it("tekst notatki: tytuł i treść, bez pustych końców", () => {
    expect(noteEmbeddingText(" Tytuł ", "")).toBe("Tytuł");
    expect(noteEmbeddingText("Tytuł", " treść ")).toBe("Tytuł\n\ntreść");
  });
});
