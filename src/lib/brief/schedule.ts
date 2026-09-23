// Kiedy złożyć briefing — czysta decyzja, bez bazy i bez zegara systemowego.
//
// PROBLEM, KTÓRY TO ROZWIĄZUJE. Harmonogram GitHub Actions jest w UTC i jest
// jeden dla wszystkich; użytkownik chce godziny lokalnej i własnej. Nie da
// się ustawić crona per użytkownik, więc job biegnie CO GODZINĘ, a ta funkcja
// mówi mu, czy to już ta godzina i czy rubryki jeszcze dziś nie ma.
//
// GRANULACJA JEST GODZINOWA I TO NIE JEST OSZCZĘDNOŚĆ. Zaplanowane przebiegi
// GitHuba potrafią spóźnić się kilkanaście minut — obiecywanie „7:45" byłoby
// obietnicą, której nie kontrolujemy. Użytkownik wybiera godzinę, a my
// mówimy wprost: „około 7:00".
import { warsawDate, warsawHour } from "@/lib/format/warsaw";

export type BriefSchedule = {
  /** Godzina lokalna (0-23), o której briefing ma być gotowy. */
  hour: number;
  /** Czy o gotowej rubryce ma powiadomić urządzenia. */
  push: boolean;
};

export const DEFAULT_BRIEF_HOUR = 7;

export type ScheduleDecision =
  | { run: true; briefDate: string }
  | { run: false; reason: "too_early" | "already_built" };

/**
 * Czy ten przebieg ma złożyć briefing.
 *
 * Zgoda pada, gdy wybita już godzina użytkownika, a rubryki na dzisiejszą
 * DOBĘ LOKALNĄ jeszcze nie ma. „Nie ma" jest warunkiem koniecznym: bez niego
 * każdy kolejny przebieg po wybranej godzinie składałby ją od nowa i wysyłał
 * kolejne powiadomienie.
 *
 * Spóźniony przebieg (np. job stanął na dwie godziny) NADRABIA zaległość
 * zamiast ją pomijać — briefing o 9:00 zamiast o 7:00 jest nadal wart
 * przeczytania, a cisza nie niesie żadnej informacji.
 */
export function decideBriefRun(
  schedule: BriefSchedule,
  now: Date,
  lastBriefDate: string | null,
): ScheduleDecision {
  const today = warsawDate(now);
  if (lastBriefDate === today) return { run: false, reason: "already_built" };
  if (warsawHour(now) < schedule.hour) return { run: false, reason: "too_early" };
  return { run: true, briefDate: today };
}
