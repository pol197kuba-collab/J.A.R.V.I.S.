// DOJAZD w briefingu — z wyniku TomTom robi małą strukturę faktów, a z niej
// zdania. Czyste: te same liczby dają ten sam tekst.
import { INCIDENT_LABEL } from "./tomtom";
import { delayMin, hm, hmOf, leaveByMin, minutesOf, warsawParts } from "./plan";
import type { CommuteOption, CommuteResult, CommuteSettings } from "./types";

export type CommuteFacts = {
  /** Planowany wyjazd, HH:MM. */
  departHm: string;
  /** Przewidywany przyjazd, HH:MM; null, gdy dostawca nie podał. */
  arriveHm: string | null;
  durationMin: number;
  typicalMin: number | null;
  /** O ile dłużej niż typowo; null bez odniesienia. */
  delayMin: number | null;
  /** Najpóźniejszy wyjazd, by zdążyć na zadaną godzinę; null, gdy nie podano. */
  leaveByHm: string | null;
  arriveByHm: string | null;
  incidents: Array<{ label: string; where: string; delayMin: number | null }>;
  detour: { via: string[]; durationMin: number; savesMin: number; avoidsIncident: boolean } | null;
};

const where = (i: CommuteResult["incidents"][number]): string =>
  [i.road, i.from && i.to ? `${i.from} → ${i.to}` : (i.from ?? i.to)].filter(Boolean).join(", ") ||
  "na trasie";

export function commuteFacts(
  result: CommuteResult,
  settings: CommuteSettings,
  /** Trasa, o którą pytamy; domyślnie domyślna. Objazd dotyczy tylko domyślnej. */
  option?: CommuteOption,
): CommuteFacts {
  const m = option?.route ?? result.main;
  const isDefault = !option || option.id === result.defaultId;
  const departAt = m.departAt ? new Date(m.departAt) : null;
  const departMin = result.direction === "to" ? settings.departToMin : settings.departBackMin;
  const leave = leaveByMin(settings.arriveByMin, m.durationSec);
  return {
    departHm: departAt && !Number.isNaN(departAt.getTime()) ? hmOf(departAt) : hm(departMin),
    arriveHm:
      m.arriveAt && !Number.isNaN(Date.parse(m.arriveAt)) ? hmOf(new Date(m.arriveAt)) : null,
    durationMin: minutesOf(m.durationSec),
    typicalMin: m.typicalSec === null ? null : minutesOf(m.typicalSec),
    delayMin: delayMin(m.durationSec, m.typicalSec),
    leaveByHm: leave === null ? null : hm(leave),
    arriveByHm: settings.arriveByMin === null ? null : hm(settings.arriveByMin),
    incidents: result.incidents
      .filter((i) => m.incidentIds.includes(i.id))
      .slice(0, 3)
      .map((i) => ({
        label: INCIDENT_LABEL[i.kind].toLowerCase(),
        where: where(i),
        delayMin: i.delaySec === null ? null : minutesOf(i.delaySec),
      })),
    detour:
      result.detour && isDefault
        ? {
            via: result.detour.via,
            durationMin: minutesOf(result.detour.route.durationSec),
            savesMin: Math.round(result.detour.savesSec / 60),
            avoidsIncident: result.detour.reason === "avoids_incident",
          }
        : null,
  };
}

/** Rubryka dotyczy tylko dni roboczych; w weekend dojazd nie jest wiadomością. */
export function isCommuteDay(now: Date): boolean {
  const w = warsawParts(now).weekday;
  return w >= 1 && w <= 5;
}

/** Progi, poniżej których dojazd „jest jak zwykle" i rubryka milczy. */
const QUIET_DELAY_MIN = 5;

export function commuteLines(f: CommuteFacts): string[] {
  const calm = f.incidents.length === 0 && (f.delayMin ?? 0) < QUIET_DELAY_MIN && !f.detour;
  const lines: string[] = [];

  let head = `Dojazd do pracy przy wyjeździe o ${f.departHm}: ${f.durationMin} min`;
  if (f.typicalMin !== null) {
    head +=
      f.delayMin !== null && f.delayMin >= QUIET_DELAY_MIN
        ? ` (typowo ${f.typicalMin}, czyli o ${f.delayMin} min dłużej)`
        : calm
          ? ", jak zwykle"
          : ` (typowo ${f.typicalMin})`;
  }
  lines.push(`${head}.`);

  for (const i of f.incidents) {
    lines.push(
      `Na trasie: ${i.label}, ${i.where}${i.delayMin ? `, około ${i.delayMin} min straty` : ""}.`,
    );
  }
  if (f.detour) {
    const d = f.detour;
    const via = d.via.length ? ` przez ${d.via.join(" i ")}` : "";
    lines.push(
      d.savesMin > 0
        ? `Objazd${via}: ${d.durationMin} min, czyli o ${d.savesMin} min krócej.`
        : `Objazd${via} omija utrudnienie: ${d.durationMin} min.`,
    );
  }
  if (f.leaveByHm && f.arriveByHm && (f.delayMin ?? 0) >= QUIET_DELAY_MIN) {
    lines.push(`Żeby być na ${f.arriveByHm}, wyjdź najpóźniej o ${f.leaveByHm}.`);
  }
  return lines;
}
