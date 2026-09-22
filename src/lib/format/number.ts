// Liczby w tekście, który czyta człowiek — jedno miejsce dla całej aplikacji.
//
// DLACZEGO NIE `toLocaleString("pl-PL")`. Ten sam kod biegnie w przeglądarce
// i w nocnych jobach na GitHub Actions, gdzie Node bywa zbudowany z
// okrojonym ICU: tam „5200" nie dostaje spacji tysięcznej i ten sam meldunek
// wygląda inaczej zależnie od tego, kto go złożył. Złapane testem przy
// stałych rozkazach, zanim zdążyło trafić na produkcję.
//
// Plik jest wspólny dla rozkazów i porannego briefingu celowo: dwa własne
// formatery to dwie różne odpowiedzi na pytanie „ile miejsc po przecinku ma
// kurs Bitcoina", a użytkownik czyta oba teksty tego samego dnia.

/**
 * Liczba bez zbędnych zer, ze spacją nierozdzielającą co trzy cyfry.
 *
 * Liczba miejsc po przecinku zależy od rzędu wielkości: przy cenie rzędu
 * tysięcy grosze są szumem, przy kursie poniżej złotówki są całą treścią.
 */
export function money(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 6;
  const fixed = abs.toFixed(digits);
  const [whole, fraction = ""] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  // Zera na końcu części dziesiętnej tylko zaśmiecają: 5,50 → 5,5; 5,00 → 5.
  const trimmed = fraction.replace(/0+$/, "");
  const sign = value < 0 ? "-" : "";
  return trimmed ? `${sign}${grouped},${trimmed}` : `${sign}${grouped}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Procent ze znakiem — plus przy wzroście jest informacją, nie ozdobą. */
export const signedPct = (value: number): string =>
  `${value > 0 ? "+" : ""}${money(round2(value))}%`;
