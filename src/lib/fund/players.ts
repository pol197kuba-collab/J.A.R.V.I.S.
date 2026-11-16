// FUNDUSZ — gracze odniesienia. Czysta logika.
//
// Koszyk „kup i trzymaj”: w dniu startu po równo w kilka najpewniejszych
// instrumentów (BASKET_SYMBOLS), potem bez ruchu. Odpowiada na pytanie: czy myślenie w ogóle
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

/**
 * Koszyk „zwykłego Kowalskiego”: kilka powszechnie uważanych za najpewniejsze
 * instrumentów — szeroki rynek (S&P 500, Nasdaq 100, cały świat), złoto, dwie
 * największe kryptowaluty, trzy gigantyczne spółki USA i największy polski
 * bank. Po równo (10% każdy), kup i trzymaj. Brak notowań instrumentu = jest
 * pomijany, reszta dzieli portfel.
 */
export const BASKET_SYMBOLS: readonly string[] = [
  "SPY.US",
  "QQQ.US",
  "ACWI.US",
  "GLD.US",
  "BTC",
  "ETH",
  "AAPL.US",
  "MSFT.US",
  "NVDA.US",
  "PKO.PL",
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
    reason: "Koszyk: po równo w kilka pewniaków, kup i trzymaj.",
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

/**
 * Jak gra każdy gracz — prostym językiem, do karty gracza. Zgodne z kodem:
 * zmiana sposobu gry (prognozy, koszyk, małpa) = zmiana tego opisu.
 */
export const PLAYER_STYLE: Record<string, { how: string; character: string }> = {
  ai: {
    how:
      "Codziennie model AI przegląda każdy instrument: jak zmieniała się cena, czy idzie w górę czy w dół, " +
      "czy nie jest „przegrzana” albo „wyprzedana” i co piszą o nim w wiadomościach. Na tej podstawie mówi, " +
      "czy w ciągu 2 dni cena wzrośnie, spadnie, czy zostanie w miejscu, i jak bardzo jest tego pewny. " +
      "Fundusz robi dokładnie to: wzrost = kupno, spadek = gra na spadki, „bez zmian” = nic nie robi. " +
      "Im większa pewność, tym większa stawka. Pozycję trzyma ok. 2 dni, chyba że kolejna prognoza ją potwierdzi.",
    character: "Szybki i ruchliwy — reaguje na to, co dzieje się teraz, dużo transakcji.",
  },
  ai_learned: {
    how:
      "Ten sam model i te same dane co „AI”, ale dostaje dodatkowo kilka wniosków policzonych z historii: " +
      "w jakiej sytuacji rynku (np. trend spadkowy na krypto) dane zagranie zarabiało, a w jakiej traciło, " +
      "oraz w jakiej sytuacji jest dziś każdy instrument. Gra na tych samych zasadach co „AI” — różni się " +
      "tylko tymi wnioskami, więc porównanie obu pokazuje, czy nauka na własnej historii coś daje.",
    character:
      "Jak „AI”, ale ostrożniejszy tam, gdzie historia mówi, że coś nie działa, i śmielszy tam, gdzie działało.",
  },
  signals: {
    how:
      "Bez sztucznej inteligencji — czysta arytmetyka. Kilka prostych miar z wykresu (czy cena jest nad średnią, " +
      "jak szybko ostatnio rosła lub spadała, czy jest blisko dołka czy szczytu ostatnich tygodni) „głosuje”, " +
      "a wynik decyduje o kierunku i pewności. Wydźwięk wiadomości też się liczy, ale słabiej niż wykres. " +
      "Prognoza na 2 dni, zagrana tak jak u „AI”.",
    character:
      "Mechaniczny i przewidywalny — zawsze ta sama reguła, bez emocji i bez interpretacji.",
  },
  ai_7d: {
    how:
      "To samo AI i ta sama codzienna analiza, ale gra prognozę na tydzień zamiast na 2 dni. Pozycje trzyma " +
      "dłużej i zmienia je rzadziej. To grupa kontrolna: sprawdza, czy skrócenie horyzontu do 2 dni " +
      "było dobrym pomysłem.",
    character: "Spokojniejszy — patrzy na dłuższy ruch, mniej reaguje na codzienne wahania.",
  },
  basket: {
    how:
      "Zachowuje się jak zwykły inwestor. W pierwszym dniu gry kupuje po równo 10 popularnych „pewniaków”: " +
      "indeksy S&P 500, Nasdaq 100 i cały świat, złoto, Bitcoina i Ethereum, Apple, Microsofta, NVIDIĘ " +
      "i PKO BP. Potem nic nie robi — nie sprzedaje, nie dokupuje, bez pożyczania i bez gry na spadki.",
    character:
      "Punkt odniesienia „kup i zapomnij” — gracz, który go nie bije, nie daje nic ponad samo bycie na rynku.",
  },
  monkey: {
    how:
      "Prognozy rzuca na ślepo: w te same dni i na te same instrumenty co prawdziwi gracze losuje, czy cena " +
      "wzrośnie, spadnie czy stoi, i z jaką pewnością. Gra na tych samych zasadach i płaci te same koszty " +
      "co reszta.",
    character:
      "Punkt odniesienia „czysty przypadek” — gracz, który nie bije małpy, nie ma w prognozach żadnej wartości.",
  },
};
