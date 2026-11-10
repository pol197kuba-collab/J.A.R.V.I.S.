// DOJAZD — składanie listy tras do wyboru z zapisanych (z punktami
// pośrednimi) i automatycznych. Czyste, bez sieci.
//
// ZASADA: automatyczne propozycje liczą się BEZ punktów użytkownika, więc
// nic ich nie zaburza; tu tylko łączymy oba zbiory i usuwamy duplikaty
// (zapisana trasa, która idzie tą samą drogą co automatyczna, nie pojawia się
// dwa razy).
import { overlapFraction } from "./geo";
import type { CommuteOption, CommuteRoute, SavedRoute } from "./types";

/** Dwie trasy pokrywające się w tym stopniu (w obie strony) to ta sama trasa. */
const SAME_ROUTE = 0.9;
const NEAR_M = 80;

const sameRoute = (a: CommuteRoute, b: CommuteRoute): boolean =>
  overlapFraction(a.points, b.points, NEAR_M) >= SAME_ROUTE &&
  overlapFraction(b.points, a.points, NEAR_M) >= SAME_ROUTE;

export const AUTO_FASTEST_ID = "auto:0";

export function assembleOptions(
  saved: ReadonlyArray<{ meta: SavedRoute; route: CommuteRoute }>,
  auto: readonly CommuteRoute[],
): { options: CommuteOption[]; defaultId: string } {
  const savedOptions: CommuteOption[] = saved.map(({ meta, route }) => ({
    id: `saved:${meta.id}`,
    kind: "saved",
    name: meta.name,
    isDefault: meta.isDefault,
    route,
  }));
  const autoOptions: CommuteOption[] = auto.map((route, i) => ({
    id: `auto:${i}`,
    kind: "auto",
    name: i === 0 ? "Najszybsza" : `Alternatywa ${i}`,
    isDefault: false,
    route,
  }));

  const savedDefault = savedOptions.find((o) => o.isDefault) ?? null;
  const defaultId = savedDefault?.id ?? AUTO_FASTEST_ID;
  if (!savedDefault && autoOptions[0]) autoOptions[0].isDefault = true;

  // Kolejność ważności przy usuwaniu duplikatów: domyślna, reszta zapisanych,
  // potem automatyczne. Zapisana trasa wygrywa z automatyczną, która jest tą samą drogą.
  const priority = [
    ...(savedDefault ? [savedDefault] : []),
    ...(!savedDefault && autoOptions[0] ? [autoOptions[0]] : []),
    ...savedOptions.filter((o) => o !== savedDefault),
    ...autoOptions.filter((o) => o !== autoOptions[0] || savedDefault),
  ];
  const kept: CommuteOption[] = [];
  for (const o of priority) {
    if (kept.some((k) => sameRoute(k.route, o.route))) continue;
    kept.push(o);
  }

  // Wyświetlanie: domyślna pierwsza, potem zapisane, potem automatyczne po czasie.
  const rank = (o: CommuteOption) => (o.id === defaultId ? 0 : o.kind === "saved" ? 1 : 2);
  kept.sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 2 ? a.route.durationSec - b.route.durationSec : 0),
  );
  return { options: kept, defaultId };
}

/** Różnica w minutach względem trasy domyślnej (dodatnia = dłużej). */
export function deltaVsDefaultMin(option: CommuteOption, def: CommuteOption): number {
  return Math.round((option.route.durationSec - def.route.durationSec) / 60);
}
