// DOJAZD — kiedy liczyć trasę i jak pokazać godziny. Czyste funkcje na czasie
// warszawskim (bez Intl — patrz src/lib/format/warsaw.ts, ten sam powód).
import { warsawOffsetHours } from "@/lib/format/warsaw";
import type { CommuteDirection, CommuteSettings } from "./types";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

export type WarsawParts = {
  /** YYYY-MM-DD */
  date: string;
  /** Minuty od północy. */
  minutes: number;
  /** 0 = niedziela … 6 = sobota. */
  weekday: number;
};

export function warsawParts(at: Date): WarsawParts {
  const shifted = new Date(at.getTime() + warsawOffsetHours(at) * 3_600_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

export const isWorkday = (weekday: number): boolean => weekday >= 1 && weekday <= 5;

/** Chwila UTC odpowiadająca dacie (YYYY-MM-DD) i minucie doby w Warszawie. */
export function warsawLocalToDate(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0) + minutes * MIN_MS;
  const summer = new Date(naive - 2 * 3_600_000);
  return warsawOffsetHours(summer) === 2 ? summer : new Date(naive - 3_600_000);
}

export type DeparturePlan = {
  /** Chwila wyjazdu, dla której pytamy o ruch. */
  at: Date;
  /** true = „teraz" (żywy ruch), false = zaplanowana godzina. */
  live: boolean;
};

/** Ile przed planowanym wyjazdem i jak długo po nim liczymy „teraz". */
const LIVE_LEAD_MIN = 30;
const LIVE_TAIL_MIN = 120;

/**
 * Dla kiedy liczyć dojazd. W oknie wokół planowanego wyjazdu (dzień roboczy)
 * liczymy „teraz" — wtedy ruch jest żywy. Poza nim: najbliższy planowany
 * wyjazd w dzień roboczy, bo odczyt z południa nie powie nic o 6:00.
 */
export function planDeparture(now: Date, departMin: number): DeparturePlan {
  const p = warsawParts(now);
  if (
    isWorkday(p.weekday) &&
    p.minutes >= departMin - LIVE_LEAD_MIN &&
    p.minutes <= departMin + LIVE_TAIL_MIN
  ) {
    return { at: now, live: true };
  }
  let date = p.date;
  let weekday = p.weekday;
  const todayStillAhead = isWorkday(weekday) && p.minutes < departMin - LIVE_LEAD_MIN;
  if (!todayStillAhead) {
    // następny dzień roboczy
    let t = Date.parse(`${p.date}T12:00:00Z`);
    do {
      t += DAY_MS;
      weekday = new Date(t).getUTCDay();
    } while (!isWorkday(weekday));
    date = new Date(t).toISOString().slice(0, 10);
  }
  return { at: warsawLocalToDate(date, departMin), live: false };
}

/** Który kierunek pokazać domyślnie: przed „południem dnia" do pracy, potem powrót. */
export function defaultDirection(
  now: Date,
  s: Pick<CommuteSettings, "departToMin" | "departBackMin">,
): CommuteDirection {
  const mid = (s.departToMin + s.departBackMin) / 2;
  return warsawParts(now).minutes <= mid ? "to" : "back";
}

/** 375 → "06:15" */
export function hm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Chwila → "HH:MM" czasu warszawskiego. */
export function hmOf(at: Date): string {
  return hm(warsawParts(at).minutes);
}

/** "06:15" → 375; null dla czegoś, co nie jest godziną. */
export function parseHm(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

export const minutesOf = (sec: number): number => Math.max(0, Math.round(sec / 60));

/** O ile minut dojazd jest dłuższy od typowego (ujemne = krótszy; null bez odniesienia). */
export function delayMin(durationSec: number, typicalSec: number | null): number | null {
  return typicalSec === null ? null : Math.round((durationSec - typicalSec) / 60);
}

/**
 * Najpóźniejszy wyjazd (minuty od północy), by zdążyć na `arriveByMin`.
 * null, gdy nie podano godziny albo wynik wypadłby przed północą.
 */
export function leaveByMin(arriveByMin: number | null, durationSec: number): number | null {
  if (arriveByMin === null) return null;
  const leave = arriveByMin - Math.ceil(durationSec / 60);
  return leave >= 0 ? leave : null;
}
