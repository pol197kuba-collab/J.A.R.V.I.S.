// DOJAZD — kiedy wolno obudzić telefon. Czysta decyzja: wynik, ustawienia i
// dotychczasowy stan dają „wyślij / nie wysyłaj" i nowy stan. Job (scripts/
// commute-watch.ts) tylko czyta i zapisuje.
//
// ZASADA: JEDEN ALERT NA KIERUNEK NA DOBĘ, chyba że jest wyraźnie gorzej.
// Korek, który trwa godzinę, nie może pukać w telefon co kwadrans — uczyłoby
// to wyciszać cały kanał. Drugi alert idzie dopiero, gdy opóźnienie urosło o
// co najmniej RE_ALERT_GROWTH_MIN względem tego, o którym już powiedzieliśmy.
import type { CommuteFacts } from "./brief";
import { hm, isWorkday, warsawParts } from "./plan";
import type { CommuteDirection, CommuteSettings } from "./types";

export type AlertState = {
  day?: string;
  to?: { delayMin: number };
  back?: { delayMin: number };
};

/** Alert dopiero, gdy opóźnienie urosło o tyle względem poprzedniego alertu. */
export const RE_ALERT_GROWTH_MIN = 10;
/** Okno sprawdzania wokół planowanego wyjazdu: od tylu minut przed… */
export const WATCH_LEAD_MIN = 45;
/** …do tylu minut po. Po wyjeździe alert „wyjdź o…" nie ma sensu. */
export const WATCH_TAIL_MIN = 10;

/** Czy teraz jest pora, by dla tego kierunku w ogóle pytać o ruch. */
export function inWatchWindow(
  now: Date,
  direction: CommuteDirection,
  s: Pick<CommuteSettings, "departToMin" | "departBackMin">,
): boolean {
  const p = warsawParts(now);
  if (!isWorkday(p.weekday)) return false;
  const dep = direction === "to" ? s.departToMin : s.departBackMin;
  return p.minutes >= dep - WATCH_LEAD_MIN && p.minutes <= dep + WATCH_TAIL_MIN;
}

export type AlertDecision =
  | { send: false; state: AlertState }
  | { send: true; state: AlertState; title: string; body: string };

export function decideAlert(
  direction: CommuteDirection,
  facts: CommuteFacts,
  settings: Pick<CommuteSettings, "alertEnabled" | "alertDelayMin">,
  prev: AlertState,
  now: Date,
): AlertDecision {
  const today = warsawParts(now).date;
  // Nowa doba zaczyna z czystym stanem.
  const state: AlertState = prev.day === today ? { ...prev } : { day: today };
  if (!settings.alertEnabled) return { send: false, state };

  const delay = facts.delayMin ?? 0;
  const serious = facts.incidents.length > 0 && facts.detour !== null;
  const over = delay >= settings.alertDelayMin;
  if (!over && !serious) return { send: false, state };

  const already = state[direction];
  if (already && delay < already.delayMin + RE_ALERT_GROWTH_MIN) {
    return { send: false, state };
  }

  const where = direction === "to" ? "do pracy" : "do domu";
  const title =
    delay >= settings.alertDelayMin
      ? `Dojazd ${where}: +${delay} min`
      : `Dojazd ${where}: utrudnienie na trasie`;

  const parts = [
    `${facts.durationMin} min` + (facts.typicalMin ? ` (typowo ${facts.typicalMin})` : ""),
  ];
  const inc = facts.incidents[0];
  if (inc) parts.push(`${inc.label}: ${inc.where}`);
  if (facts.detour) {
    const via = facts.detour.via.length ? ` przez ${facts.detour.via.join(" i ")}` : "";
    parts.push(`objazd${via}: ${facts.detour.durationMin} min`);
  }
  if (direction === "to" && facts.leaveByHm) parts.push(`wyjdź najpóźniej o ${facts.leaveByHm}`);
  else parts.push(`wyjazd ${facts.departHm || hm(0)}`);

  state[direction] = { delayMin: delay };
  return { send: true, state, title, body: parts.join(". ") + "." };
}
