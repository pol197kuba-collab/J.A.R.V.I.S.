// Czas warszawski bez Intl.
//
// DLACZEGO NIE `Intl.DateTimeFormat(..., { timeZone: "Europe/Warsaw" })`. Ten
// kod biegnie w nocnym jobie na GitHub Actions, gdzie Node bywa zbudowany z
// okrojonym ICU — a już raz nas to kosztowało (spacja tysięczna znikająca
// tylko w jobie, patrz src/lib/format/number.ts). Reguła polskiego czasu
// letniego jest na tyle prosta, że własne dziesięć linijek jest pewniejsze
// niż zależność od tego, jak zbudowano interpreter.
//
// REGUŁA (dyrektywa 2000/84/WE, obowiązuje w całej UE): czas letni zaczyna
// się w OSTATNIĄ niedzielę marca o 01:00 UTC i kończy w ostatnią niedzielę
// października o 01:00 UTC. Poza tym okresem obowiązuje UTC+1, w nim UTC+2.

/** Moment przestawienia zegara: ostatnia niedziela danego miesiąca, 01:00 UTC. */
function lastSundayUtc(year: number, monthIndex: number): number {
  // Dzień 0 następnego miesiąca to ostatni dzień tego miesiąca.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const daysBack = lastDay.getUTCDay(); // 0 = niedziela
  return Date.UTC(year, monthIndex, lastDay.getUTCDate() - daysBack, 1, 0, 0);
}

/** Przesunięcie względem UTC w godzinach: 1 zimą, 2 latem. */
export function warsawOffsetHours(date: Date): 1 | 2 {
  const year = date.getUTCFullYear();
  const start = lastSundayUtc(year, 2); // marzec
  const end = lastSundayUtc(year, 9); // październik
  const t = date.getTime();
  return t >= start && t < end ? 2 : 1;
}

/** Godzina warszawska (0-23) dla podanej chwili. */
export function warsawHour(date: Date): number {
  const shifted = new Date(date.getTime() + warsawOffsetHours(date) * 3_600_000);
  return shifted.getUTCHours();
}

/** Data warszawska w formacie ISO (YYYY-MM-DD) — doba liczona lokalnie.
 *
 *  Ma znaczenie o północy: o 00:30 czasu warszawskiego w UTC jest jeszcze
 *  poprzedni dzień, a briefing „z dzisiaj" ma znaczyć dzisiaj tutaj. */
export function warsawDate(date: Date): string {
  const shifted = new Date(date.getTime() + warsawOffsetHours(date) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}
