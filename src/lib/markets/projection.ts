// MARKET GRID — dorysowanie prognozy za dzisiejszą datę.
//
// CZYM TO JEST, A CZYM NIE JEST. To nie jest przewidywanie ceny. To jest
// narysowanie tego, co typer i tak już policzył: kierunku, siły przekonania i
// zakresu, w którym cena może się znaleźć na koniec horyzontu. Wykres
// kończył się dotąd na dzisiaj, więc prognoza żyła wyłącznie jako liczba w
// panelu obok — a to jest dokładnie ten rodzaj informacji, który czyta się
// okiem, nie tabelką.
//
// SKĄD SIĘ BIERZE OCZEKIWANY RUCH. Nie z samego wyniku typera: ±100 punktów
// na spokojnej walucie i na Bitcoinie to dwa zupełnie różne ruchy w
// procentach. Skala bierze się więc ze ZMIENNOŚCI samego instrumentu —
// zmienność roczną przeliczamy na horyzont prognozy i traktujemy ją jako
// pełny ruch przy maksymalnym wyniku. Dzięki temu strzałka na spokojnym
// instrumencie zostaje krótka, choćby typer był jej najpewniejszy.
//
// PASMO NIEPEWNOŚCI JEST SZERSZE NIŻ SAMA PROGNOZA, i tak ma być. Wąskie
// pasmo obiecywałoby precyzję, której nikt tu nie ma. Im niższe przekonanie
// typera, tym pasmo szersze — na wykresie widać wtedy, że to zgadywanie, bez
// czytania procentów.
import { annualizedVolatility } from "./signals";
import type { SignalDirection } from "./signals";
import type { PricePoint } from "./series";

export type ForecastPoint = {
  date: string;
  /** Środek prognozy — tam typer spodziewa się ceny na koniec horyzontu. */
  mid: number;
  /** Dolna i górna krawędź pasma niepewności. */
  low: number;
  high: number;
};

/** Ile sesji w roku przyjmujemy przy skalowaniu zmienności na horyzont. */
const TRADING_DAYS_PER_YEAR = 252;

/** Zmienność zastępcza, gdy historia jest za krótka, żeby ją policzyć.
 *  Celowo niewielka: brak danych ma dawać ostrożną prognozę, nie odważną. */
const FALLBACK_ANNUAL_VOL_PCT = 20;

/** Górne ograniczenie oczekiwanego ruchu. Zmienność potrafi wystrzelić po
 *  jednej gwałtownej sesji, a prognoza „+80% w tydzień" nie jest prognozą,
 *  tylko usterką wykresu. */
const MAX_EXPECTED_MOVE_PCT = 25;

/** Absolutny próg szerokości pasma — tylko po to, żeby nie wyszło zerowe.
 *  Celowo bardzo mały: sensowna dolna granica jest WZGLĘDNA (niżej), bo próg
 *  liczony w punktach procentowych jest nieporównywalny między instrumentami.
 *  Jeden procent to nic na krypto i bardzo dużo na parze walutowej — jako
 *  próg przykrywał na spokojnych instrumentach cały wpływ przekonania. */
const MIN_BAND_PCT = 0.05;

/** Pasmo nigdy węższe niż połowa prognozowanego ruchu. Pasmo węższe od
 *  własnej prognozy sugerowałoby, że ruch jest pewniejszy niż jego skala. */
const BAND_TO_MOVE_FLOOR = 0.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Kolejny dzień kalendarzowy w formacie ISO (bez strefy czasowej). */
const nextDay = (iso: string, offset: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * Buduje ścieżkę prognozy od ostatniego notowania w przód.
 *
 * Zwraca PUSTĄ tablicę, gdy nie ma z czego prognozować (brak notowań) albo
 * gdy typer nie ma zdania (`flat`) — dorysowywanie płaskiej kreski w
 * przyszłość sugerowałoby prognozę „bez zmian", a to zupełnie co innego niż
 * „nie wiem". Pusty wynik znaczy „nie rysuj", i wykres to uszanuje.
 */
export function projectForecast(
  points: PricePoint[],
  outlook: { score: number; direction: SignalDirection; confidence: number },
  horizonDays: number,
): ForecastPoint[] {
  if (points.length === 0 || horizonDays <= 0) return [];
  if (outlook.direction === "flat") return [];

  const last = points[points.length - 1];
  if (!(last.close > 0)) return [];

  // Uwaga na ZERO, nie tylko na null. Seria o idealnie równym tempie wzrostu
  // ma zerowe odchylenie zwrotów, więc zmienność wychodzi 0 — a to dałoby
  // płaską prognozę przy kierunku „wzrost", czyli wykres przeczący własnemu
  // werdyktowi. Zero jest tu tak samo bezużyteczne jak brak wyniku.
  const measured = annualizedVolatility(points);
  const annualVol = measured !== null && measured > 0 ? measured : FALLBACK_ANNUAL_VOL_PCT;
  // Zmienność roczna → zmienność horyzontu. Pierwiastek z czasu, nie
  // proporcja: ruchy cen kumulują się jak błądzenie losowe, więc tydzień to
  // nie 1/52 rocznej zmienności.
  const horizonVolPct = annualVol * Math.sqrt(horizonDays / TRADING_DAYS_PER_YEAR);

  const strength = clamp(outlook.score, -100, 100) / 100;
  const movePct = clamp(strength * horizonVolPct, -MAX_EXPECTED_MOVE_PCT, MAX_EXPECTED_MOVE_PCT);

  // Pasmo: od pełnej zmienności horyzontu przy zerowym przekonaniu do jej
  // połowy przy przekonaniu maksymalnym, ale nigdy węższe niż połowa samego
  // prognozowanego ruchu.
  const certainty = clamp(outlook.confidence, 0, 100) / 100;
  const bandPct = Math.max(
    MIN_BAND_PCT,
    Math.abs(movePct) * BAND_TO_MOVE_FLOOR,
    horizonVolPct * (1 - certainty * 0.5),
  );

  const out: ForecastPoint[] = [];
  for (let day = 1; day <= horizonDays; day += 1) {
    const progress = day / horizonDays;
    const mid = last.close * (1 + (movePct / 100) * progress);
    // Pasmo rozszerza się z czasem, a nie od razu na pełną szerokość —
    // jutrzejsza cena jest znana dużo lepiej niż ta za tydzień.
    const spread = last.close * (bandPct / 100) * Math.sqrt(progress);
    out.push({
      date: nextDay(last.date, day),
      mid,
      low: mid - spread,
      high: mid + spread,
    });
  }
  return out;
}
