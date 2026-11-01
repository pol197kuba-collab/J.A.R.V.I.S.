// FUNDUSZ — gracze odniesienia. Czysta logika.
//
// Koszyk „kup i trzymaj wszystko”: w dniu startu po równo we wszystkie
// instrumenty, na których grają pozostali (krypto, akcje, indeksy, surowce,
// waluty), potem bez ruchu. Odpowiada na pytanie: czy myślenie w ogóle
// dało więcej niż samo bycie na rynku?
//
// Małpa z rzutkami: losowe prognozy na tych samych instrumentach i w te same
// dni co prawdziwi gracze, z tymi samymi zasadami i kosztami. Jeśli prognozy
// jej nie biją — wiadomo, ile są warte. Losowość deterministyczna (ziarno),
// więc przeliczenie historii daje zawsze ten sam wynik.

import { seededRandom } from "@/lib/brain/projection";
import type { Direction, FundSignal } from "./engine";

export type PlayerKind = "source" | "benchmark" | "monkey";

export type PlayerDef = {
  key: string;
  label: string;
  kind: PlayerKind;
  /** Gracz-źródło: czyje prognozy gra (market_predictions.source). Brak = key. */
  source?: string;
  /** Gracz-źródło: prognozy o jakim horyzoncie gra. */
  horizonDays?: number;
};

/** Horyzont główny i kontrolny — te same co w typerze (forecast.server). */
export const MAIN_HORIZON = 2;
export const CONTROL_HORIZON = 7;

/**
 * Gracze funduszu: źródła prognoz + odniesienia. Kolejność = kolejność w UI.
 * „AI (7 dni)” to kontrola zmiany horyzontu: ten sam model, ta sama
 * odpowiedź, ale prognoza tygodniowa i jej wcześniejsza historia — jeśli
 * gracze dwudniowi go nie biją, skrócenie horyzontu nie pomogło.
 */
export const PLAYERS: PlayerDef[] = [
  { key: "ai_learned", label: "AI z wnioskami", kind: "source", horizonDays: MAIN_HORIZON },
  { key: "ai", label: "AI", kind: "source", horizonDays: MAIN_HORIZON },
  { key: "signals", label: "Sygnały techniczne", kind: "source", horizonDays: MAIN_HORIZON },
  {
    key: "ai_7d",
    label: "AI (7 dni, kontrola)",
    kind: "source",
    source: "ai",
    horizonDays: CONTROL_HORIZON,
  },
  { key: "basket", label: "Kup i trzymaj wszystko", kind: "benchmark" },
  { key: "monkey", label: "Małpa z rzutkami", kind: "monkey" },
];

export function basketSignals(symbols: string[], startDay: string): FundSignal[] {
  const unique = [...new Set(symbols)].sort();
  if (unique.length === 0) return [];
  const weight = 1 / unique.length;
  return unique.map((symbol) => ({
    symbol,
    madeOn: startDay,
    direction: "up" as const,
    confidence: 100,
    weight,
    reason: "Koszyk: po równo we wszystkie instrumenty, kup i trzymaj.",
    predictionId: null,
  }));
}

/** Szansa, że małpa rzuci w danym dniu na danym instrumencie. */
const MONKEY_THROW = 0.35;
const DIRECTIONS: Direction[] = ["up", "down", "flat"];

export function monkeySignals(
  symbolDays: { symbol: string; day: string; at?: string | null }[],
  seed = 1984,
  horizonDays = MAIN_HORIZON,
): FundSignal[] {
  const rnd = seededRandom(seed);
  const sorted = [...symbolDays].sort(
    (a, b) => a.day.localeCompare(b.day) || a.symbol.localeCompare(b.symbol),
  );
  const out: FundSignal[] = [];
  for (const { symbol, day, at } of sorted) {
    // Zawsze trzy losowania na krok — wynik nie zależy od tego, czy rzuciła.
    const throwIt = rnd() < MONKEY_THROW;
    const direction = DIRECTIONS[Math.floor(rnd() * 3)];
    const confidence = Math.round(40 + rnd() * 50);
    if (!throwIt) continue;
    out.push({
      symbol,
      madeOn: day,
      direction,
      confidence,
      reason: "Rzut rzutką.",
      predictionId: null,
      horizonDays,
      ...(at ? { madeAt: at } : {}),
    });
  }
  return out;
}
