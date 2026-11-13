// Odpowiedź narzędzia `check_commute` dla agenta — te same fakty co rubryka
// briefingu (commuteFacts), ale dla obu kierunków i z listą tras do wyboru.
// Czyste: ten sam wynik TomTom daje tę samą odpowiedź.
import { commuteFacts, type CommuteFacts } from "./brief";
import { minutesOf } from "./plan";
import type { CommuteResult, CommuteSettings } from "./types";

export type CommuteToolReply = {
  direction: "to_work" | "home";
  from: string;
  to: string;
  /** true = żywy ruch teraz; false = prognoza na planowaną godzinę wyjazdu. */
  live: boolean;
  facts: CommuteFacts;
  /** Trasy do wyboru, domyślna pierwsza (najwyżej 4). */
  routes: Array<{ name: string; isDefault: boolean; durationMin: number; distanceKm: number }>;
  /** Gotowe zdania po polsku — agent może je powtórzyć albo streścić. */
  summary: string[];
};

const MAX_ROUTES = 4;

export function commuteToolReply(
  result: CommuteResult,
  settings: CommuteSettings,
): CommuteToolReply {
  const facts = commuteFacts(result, settings);
  const toWork = result.direction === "to";
  const where = toWork ? "do pracy" : "do domu";
  const when = result.live ? "teraz" : `przy wyjeździe o ${facts.departHm}`;

  let head = `Droga ${where} ${when}: ${facts.durationMin} min`;
  if (facts.typicalMin !== null) {
    head +=
      facts.delayMin !== null && facts.delayMin > 0
        ? ` (typowo ${facts.typicalMin}, o ${facts.delayMin} min dłużej)`
        : ` (typowo ${facts.typicalMin})`;
  }
  if (facts.arriveHm) head += `, na miejscu około ${facts.arriveHm}`;
  const summary = [`${head}.`];

  if (facts.incidents.length === 0) summary.push("Na trasie nie ma zgłoszonych utrudnień.");
  for (const i of facts.incidents) {
    summary.push(
      `Utrudnienie: ${i.label}, ${i.where}${i.delayMin ? `, około ${i.delayMin} min straty` : ""}.`,
    );
  }
  if (facts.detour) {
    const d = facts.detour;
    const via = d.via.length ? ` przez ${d.via.join(" i ")}` : "";
    summary.push(
      d.savesMin > 0
        ? `Objazd${via}: ${d.durationMin} min, o ${d.savesMin} min krócej.`
        : `Objazd${via} omija utrudnienie: ${d.durationMin} min.`,
    );
  }
  if (toWork && facts.leaveByHm && facts.arriveByHm) {
    summary.push(
      `Żeby być na ${facts.arriveByHm}, trzeba wyjechać najpóźniej o ${facts.leaveByHm}.`,
    );
  }

  return {
    direction: toWork ? "to_work" : "home",
    from: result.origin.label,
    to: result.destination.label,
    live: result.live,
    facts,
    routes: result.options.slice(0, MAX_ROUTES).map((o) => ({
      name: o.name,
      isDefault: o.isDefault,
      durationMin: minutesOf(o.route.durationSec),
      distanceKm: Math.round(o.route.distanceM / 100) / 10,
    })),
    summary,
  };
}
