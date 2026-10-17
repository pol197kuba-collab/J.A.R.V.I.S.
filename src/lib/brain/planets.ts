// Mózg 3D — tryb STRUKTURA: wygląd planet. Czysta logika (bez three.js).
//
// Każda tabela dostaje stały, „losowy” wygląd wyliczony z nazwy (ten sam
// przy każdym wejściu): typ planety, wariant barw, ziarno szumu dla shadera
// i ewentualne pierścienie. Kolory tutaj to GRAFIKA (barwy prawdziwych
// planet), nie kolory interfejsu — wyjątek od reguły tokenów jak paleta
// Town (CLAUDE.md). Moduł tabeli niesie poświata atmosfery w kolorze tokenu.

export type PlanetKind = "rocky" | "gas" | "ice" | "lava" | "terran";

/** Indeks typu przekazywany shaderowi (atrybut instancji). */
export const PLANET_KIND_INDEX: Record<PlanetKind, number> = {
  rocky: 0,
  gas: 1,
  ice: 2,
  lava: 3,
  terran: 4,
};

export const PLANET_KIND_LABEL: Record<PlanetKind, string> = {
  rocky: "skalista",
  gas: "gazowy olbrzym",
  ice: "lodowa",
  lava: "wulkaniczna",
  terran: "ziemiopodobna",
};

/** [baza, cień/drugi ton, akcent] — sRGB, jak w CSS. */
type Palette = readonly [string, string, string];

const PALETTES: Record<PlanetKind, readonly Palette[]> = {
  rocky: [
    ["#8a7f72", "#4a423b", "#c9bba8"], // księżycowa
    ["#b0582f", "#5a2a17", "#e09a66"], // marsjańska
    ["#77705f", "#3a3830", "#a89f88"], // merkuriańska
  ],
  gas: [
    ["#c9a27a", "#8a5638", "#f2e2c4"], // jowiszowa
    ["#d9c48c", "#a3854e", "#f5ecd2"], // saturnowa
    ["#6f8fd0", "#33468a", "#cdd9f5"], // błękitny olbrzym
    ["#c27aa6", "#6b3561", "#f0cde0"], // różowy olbrzym
  ],
  ice: [
    ["#9fdbe6", "#4f9fb8", "#effbfd"], // uranowa
    ["#4f78e0", "#22388f", "#b3c8f7"], // neptunowa
  ],
  lava: [
    ["#2b1b17", "#100a09", "#ff6a1a"], // pomarańczowa magma
    ["#271a2c", "#0e0911", "#ff3d6e"], // różowa magma
  ],
  terran: [
    ["#1c4f93", "#3d7a37", "#d6c69c"], // ocean, lasy, wyżyny
    ["#1a5f6f", "#6e5a38", "#cdb487"], // turkusowa, pustynna
  ],
};

export type PlanetLook = {
  kind: PlanetKind;
  /** 0..1 — przesuwa szum i tempo obrotu w shaderze. */
  seed: number;
  colors: Palette;
  /** Nachylenie pierścieni w radianach albo null (bez pierścieni). */
  ringTilt: number | null;
};

/** FNV-1a → 0..1. Stabilne między przeglądarkami (bez Math.random). */
export function hashUnit(text: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

const pick = <T>(items: readonly T[], u: number): T =>
  items[Math.min(items.length - 1, Math.floor(u * items.length))];

/** Tyle największych tabel to gazowe olbrzymy (reszta: skały, lód, lawa). */
const GIANT_SHARE = 0.3;
/** Pierścienie: najwięcej powiązań, co najmniej tyle, maks. tyle planet. */
const RING_MIN_DEGREE = 3;
const RING_MAX = 3;

/**
 * Wygląd planet dla listy tabel. `degree[i]` = liczba kluczy obcych
 * tabeli i (w obie strony). Największa tabela to „planeta domowa”
 * (ziemiopodobna), kolejne największe — gazowe olbrzymy, reszta losowo
 * z nazwy: skalista 50%, lodowa 25%, wulkaniczna 25%.
 */
export function planetLooks(
  tables: { name: string; rows: number }[],
  degree: number[],
): PlanetLook[] {
  const byRows = tables
    .map((t, i) => ({ i, rows: Math.max(0, t.rows) }))
    .sort((a, b) => b.rows - a.rows || tables[a.i].name.localeCompare(tables[b.i].name));
  const rank = new Map(byRows.map((r, k) => [r.i, k]));
  const giants = Math.round(tables.length * GIANT_SHARE);

  const ringed = new Set(
    degree
      .map((d, i) => ({ i, d }))
      .filter((x) => x.d >= RING_MIN_DEGREE)
      .sort((a, b) => b.d - a.d || tables[a.i].name.localeCompare(tables[b.i].name))
      .slice(0, RING_MAX)
      .map((x) => x.i),
  );

  return tables.map((t, i) => {
    const r = rank.get(i) ?? 0;
    const u = hashUnit(t.name, 1);
    let kind: PlanetKind;
    if (r === 0 && Math.max(0, t.rows) > 0) kind = "terran";
    else if (r < giants) kind = "gas";
    else kind = u < 0.5 ? "rocky" : u < 0.75 ? "ice" : "lava";
    // Ziemia z pierścieniami wygląda sztucznie — pierścienie dostaje inny węzeł.
    const rings = ringed.has(i) && kind !== "terran";
    return {
      kind,
      seed: hashUnit(t.name, 2),
      colors: pick(PALETTES[kind], hashUnit(t.name, 3)),
      ringTilt: rings ? (hashUnit(t.name, 4) - 0.5) * 0.9 : null,
    };
  });
}

/** Stopień każdego węzła z listy krawędzi [a, b] (pętle się nie liczą). */
export function nodeDegrees(count: number, edges: [number, number][]): number[] {
  const deg = new Array<number>(count).fill(0);
  for (const [a, b] of edges) {
    if (a === b) continue;
    if (a >= 0 && a < count) deg[a]++;
    if (b >= 0 && b < count) deg[b]++;
  }
  return deg;
}
