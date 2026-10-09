// Agent Town — things on the map you can use in walk mode. Pure data: where
// each prop is, which tiles you can use it from, and what the "E · …" prompt
// says. What using it actually does lives in TownView (it needs the world,
// the router and real data).

import type { Tile } from "./townMap";

export type PropKind =
  | "coffee"
  | "vending"
  | "shelf"
  | "arcade"
  | "pc"
  | "sofa"
  | "dogbed"
  | "pingpong"
  | "globe"
  | "whiteboard";

export type TownProp = {
  id: string;
  kind: PropKind;
  /** Shown as the dialog's speaker line. */
  name: string;
  /** Verb on the "E · …" prompt. */
  prompt: string;
  /** Tiles you can stand on to use it. */
  stand: readonly Tile[];
  /** Where the prompt floats (tile coordinates, may be fractional). */
  anchor: readonly [number, number];
};

const row = (y: number, x0: number, x1: number): Tile[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as Tile);

export const PROPS: readonly TownProp[] = [
  {
    id: "coffee-terminal",
    kind: "coffee",
    name: "Ekspres do kawy",
    prompt: "Kawa",
    stand: [
      [27, 24],
      [26, 23],
    ],
    anchor: [27.5, 22.4],
  },
  {
    id: "coffee-hall",
    kind: "coffee",
    name: "Ekspres do kawy",
    prompt: "Kawa",
    stand: [
      [4, 13],
      [5, 12],
    ],
    anchor: [4.5, 11.4],
  },
  {
    id: "vending",
    kind: "vending",
    name: "Automat z przekąskami",
    prompt: "Przekąska",
    stand: [[3, 13]],
    anchor: [3.5, 11.2],
  },
  {
    id: "shelf-west",
    kind: "shelf",
    name: "Regał z dokumentami",
    prompt: "Dokumenty",
    stand: row(5, 3, 6),
    anchor: [5, 3.2],
  },
  {
    id: "shelf-east",
    kind: "shelf",
    name: "Regał z dokumentami",
    prompt: "Dokumenty",
    stand: row(5, 11, 14),
    anchor: [13, 3.2],
  },
  {
    id: "arcade",
    kind: "arcade",
    name: "Automat „Złap buga”",
    prompt: "Graj",
    stand: row(13, 39, 40),
    anchor: [40, 11.2],
  },
  {
    id: "pc",
    kind: "pc",
    name: "Twój komputer",
    prompt: "Komputer",
    stand: row(25, 19, 21),
    anchor: [20.5, 23.6],
  },
  {
    id: "sofa-terminal",
    kind: "sofa",
    name: "Kanapa",
    prompt: "Odpocznij",
    stand: row(27, 24, 26),
    anchor: [25.5, 27.4],
  },
  {
    id: "sofa-hall",
    kind: "sofa",
    name: "Kanapa",
    prompt: "Odpocznij",
    stand: row(18, 5, 7),
    anchor: [6.5, 18.4],
  },
  {
    id: "dogbed",
    kind: "dogbed",
    name: "Posłanie",
    prompt: "Posłanie",
    stand: [
      [17, 25],
      [16, 26],
      [18, 26],
      [17, 27],
    ],
    anchor: [17.5, 25.6],
  },
  {
    id: "pingpong",
    kind: "pingpong",
    name: "Stół do ping-ponga",
    prompt: "Pobaw się",
    stand: [...row(14, 33, 35), ...row(17, 33, 35), [32, 15], [32, 16], [36, 15], [36, 16]],
    anchor: [34.5, 14.6],
  },
  {
    id: "globe",
    kind: "globe",
    name: "Globus",
    prompt: "Zakręć",
    stand: [
      [12, 8],
      [13, 9],
    ],
    anchor: [13.5, 7.4],
  },
  {
    id: "whiteboard",
    kind: "whiteboard",
    name: "Tablica wyników",
    prompt: "Statystyki",
    stand: row(4, 16, 18),
    anchor: [17.5, 3],
  },
];

/** The prop usable from this tile, if any. */
export function propAt(tx: number, ty: number): TownProp | null {
  return PROPS.find((p) => p.stand.some(([x, y]) => x === tx && y === ty)) ?? null;
}

export const propById = (id: string) => PROPS.find((p) => p.id === id) ?? null;
