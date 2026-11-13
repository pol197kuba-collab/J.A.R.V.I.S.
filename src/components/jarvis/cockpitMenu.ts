// Pure logic of the desktop "Kokpit" menu: four holographic columns (one per
// module group) standing in an arc around the Arc Core. Columns, one-line
// descriptions, search and arrow-key movement. No React, no DOM.

import { MODULE_GROUPS, type ModuleEntry } from "./modules";
import { moduleBlurb } from "./login-scene/landingData";

/**
 * Descriptions for the modules without an approved landing-page blurb.
 * Plain statements of what the module is — no data, no claims.
 */
const EXTRA_BLURBS: Readonly<Record<string, string>> = {
  "J.A.R.V.I.S.": "Macierz agentów na żywo",
  "Agent Town": "Pixel-artowe biuro na żywych danych",
  "Agent Hub": "Rejestr i ustawienia agentów",
  "System Logs": "Dzienniki i błędy",
  Settings: "Klucze API i preferencje",
};

export const cockpitBlurb = (title: string): string =>
  moduleBlurb(title) ?? EXTRA_BLURBS[title] ?? "";

export interface CockpitColumn {
  id: string;
  label: string;
  items: readonly ModuleEntry[];
}

/** The four columns, left to right, in the order of the module groups. */
export const cockpitColumns = (): CockpitColumn[] =>
  MODULE_GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items }));

/** Selection: column and row. */
export type CockpitSel = [number, number];

/** Does a module match the search text (title, short title, keywords, description)? */
export function cockpitMatches(item: ModuleEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.shortTitle, item.keywords ?? "", cockpitBlurb(item.title)]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * The best match: a module whose name starts with the text, then one whose name
 * contains it, then any match (keywords, description) — each in reading order.
 */
export function firstMatch(cols: CockpitColumn[], query: string): CockpitSel | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const names = (i: ModuleEntry) => [i.title, i.shortTitle].map((n) => n.toLowerCase());
  const tests: Array<(i: ModuleEntry) => boolean> = [
    (i) => names(i).some((n) => n.startsWith(q)),
    (i) => names(i).some((n) => n.includes(q)),
    (i) => cockpitMatches(i, q),
  ];
  for (const test of tests)
    for (let c = 0; c < cols.length; c++)
      for (let r = 0; r < cols[c].items.length; r++) if (test(cols[c].items[r])) return [c, r];
  return null;
}

/**
 * Arrow keys: up/down walk the column (skipping filtered-out modules, wrapping),
 * left/right jump to the neighbour column at the closest row.
 */
export function moveSel(
  cols: CockpitColumn[],
  sel: CockpitSel | null,
  key: "up" | "down" | "left" | "right",
  query = "",
): CockpitSel {
  const start: CockpitSel = sel ?? [Math.min(1, cols.length - 1), 0];
  if (!sel) return start;
  let [c, r] = start;
  if (key === "left" || key === "right") {
    c = (c + (key === "right" ? 1 : -1) + cols.length) % cols.length;
    return [c, Math.min(r, cols[c].items.length - 1)];
  }
  const n = cols[c].items.length;
  const step = key === "down" ? 1 : -1;
  for (let k = 0; k < n; k++) {
    r = (r + step + n) % n;
    if (cockpitMatches(cols[c].items[r], query)) return [c, r];
  }
  return start;
}
