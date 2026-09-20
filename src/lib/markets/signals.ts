// MARKET GRID — deterministyczne sygnały techniczne. Etap 3 modułu /rynki.
//
// Ten plik jest liczbową połową „typera". Cała arytmetyka siedzi tutaj,
// bez I/O i bez modelu, żeby dała się przetestować jednostkowo i żeby
// wynik był POWTARZALNY: te same notowania zawsze dają ten sam wynik.
// Model dostaje te liczby gotowe i ma je zinterpretować, a nie wymyślić —
// LLM proszony o policzenie RSI poda liczbę, która wygląda wiarygodnie i
// bywa nieprawdziwa.
//
// ZASTRZEŻENIE WBUDOWANE W PROJEKT: to są wskaźniki opisujące przeszłość.
// Żaden z nich nie „wie", co będzie — wysoki wynik znaczy tylko, że kilka
// niezależnych miar wskazuje w tę samą stronę. Dlatego obok kierunku zawsze
// idzie pewność i lista przesłanek, a trafność jest mierzona (patrz
// market_predictions i panel skuteczności).
import { normalizeSeries, type PricePoint } from "./series";

export type SignalDirection = "up" | "down" | "flat";

export type TechnicalSignals = {
  /** RSI Wildera, 14 okresów. null przy zbyt krótkiej serii. */
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  /** Odległość ceny od SMA20 w %, dodatnia = cena powyżej średniej. */
  distanceFromSma20: number | null;
  /** Zmiana w % przez ostatnie 5 i 20 sesji. */
  momentum5: number | null;
  momentum20: number | null;
  /** Roczna zmienność w % (z 60 ostatnich sesji). */
  volatility: number | null;
  /** Pozycja ceny w zakresie 60 sesji, 0-100. */
  rangePosition: number | null;
  /** Ile sesji faktycznie weszło do rachunku. */
  points: number;
};

export type SignalDriver = {
  label: string;
  /** Wkład do wyniku, od -30 do +30. */
  contribution: number;
  /** Jednozdaniowe wyjaśnienie po polsku — trafia wprost do UI. */
  note: string;
};

export type TechnicalOutlook = {
  signals: TechnicalSignals;
  /** Wypadkowa od -100 (spadkowo) do +100 (wzrostowo). */
  score: number;
  direction: SignalDirection;
  /** 0-100. Niska przy sprzecznych przesłankach i przy krótkiej historii. */
  confidence: number;
  drivers: SignalDriver[];
};

const sma = (points: PricePoint[], window: number): number | null => {
  if (points.length < window) return null;
  const slice = points.slice(-window);
  return slice.reduce((acc, p) => acc + p.close, 0) / window;
};

const pctChange = (from: number, to: number): number | null =>
  from > 0 ? ((to - from) / from) * 100 : null;

/**
 * RSI Wildera (14 okresów), liczony wygładzaniem wykładniczym — nie średnią
 * prostą z ostatnich 14 sesji. To rozróżnienie ma znaczenie: wersja z
 * prostą średnią daje inne wartości i nie jest tym, co pokazują platformy
 * giełdowe, więc porównanie „nasz RSI vs RSI z brokera" by się nie zgadzało.
 */
export function computeRsi(points: PricePoint[], period = 14): number | null {
  if (points.length < period + 1) return null;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = points[i].close - points[i - 1].close;
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < points.length; i++) {
    const delta = points[i].close - points[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  // Seria bez ani jednego spadku daje RSI 100 — to poprawny wynik, nie
  // dzielenie przez zero.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function annualizedVolatility(points: PricePoint[]): number | null {
  if (points.length < 5) return null;
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    if (prev > 0) returns.push(points[i].close / prev - 1);
  }
  if (returns.length < 4) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function computeSignals(rawPoints: PricePoint[]): TechnicalSignals {
  const points = normalizeSeries(rawPoints);
  const empty: TechnicalSignals = {
    rsi: null,
    sma20: null,
    sma50: null,
    distanceFromSma20: null,
    momentum5: null,
    momentum20: null,
    volatility: null,
    rangePosition: null,
    points: points.length,
  };
  if (points.length < 2) return empty;

  const last = points[points.length - 1].close;
  const sma20 = sma(points, 20);
  const sma50 = sma(points, 50);

  const window = points.slice(-60);
  const closes = window.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  const at = (sessionsBack: number): number =>
    points[Math.max(0, points.length - 1 - sessionsBack)].close;

  return {
    rsi: computeRsi(points),
    sma20,
    sma50,
    distanceFromSma20: sma20 ? pctChange(sma20, last) : null,
    momentum5: points.length > 5 ? pctChange(at(5), last) : null,
    momentum20: points.length > 20 ? pctChange(at(20), last) : null,
    volatility: annualizedVolatility(window),
    rangePosition: max > min ? ((last - min) / (max - min)) * 100 : null,
    points: points.length,
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Składa sygnały w jedną ocenę.
 *
 * KIERUNEK LICZĄ trend (przecięcie średnich) i momentum. RSI oraz pozycja w
 * zakresie NIE dokładają własnego kierunku — one TŁUMIĄ sygnał, gdy rynek
 * jest już rozciągnięty w tę samą stronę, w którą wskazuje trend.
 *
 * Ta konstrukcja jest odpowiedzią na konkretny błąd wykryty testem:
 * przy poprzedniej wersji (RSI jako osobny, przeciwny wkład) nieprzerwany
 * trend wzrostowy dostawał wynik 14 i etykietę „bez kierunku", bo kara za
 * wykupienie niemal kasowała trend i momentum. Najsilniejszy możliwy trend
 * czytany jako brak sygnału to nie konserwatyzm, tylko usterka. Teraz
 * wykupienie obniża taki sygnał najwyżej o 45%, ale nigdy go nie odwraca —
 * żeby odwrócić kierunek, musi zawrócić cena.
 *
 * Zmienność nie wpływa na kierunek, tylko obniża pewność: ten sam sygnał na
 * instrumencie o zmienności 20% i 120% nie jest tak samo wiarygodny.
 */
export function scoreSignals(signals: TechnicalSignals): TechnicalOutlook {
  const directional: SignalDriver[] = [];

  if (signals.sma20 !== null && signals.sma50 !== null) {
    const spread = ((signals.sma20 - signals.sma50) / signals.sma50) * 100;
    directional.push({
      label: "Trend (SMA20 vs SMA50)",
      contribution: clamp(spread * 4, -35, 35),
      note:
        spread > 0
          ? `Średnia z 20 sesji jest ${spread.toFixed(1)}% nad średnią z 50 — układ wzrostowy.`
          : `Średnia z 20 sesji jest ${Math.abs(spread).toFixed(1)}% pod średnią z 50 — układ spadkowy.`,
    });
  }

  if (signals.momentum20 !== null) {
    directional.push({
      label: "Momentum 20 sesji",
      contribution: clamp(signals.momentum20 * 1.5, -35, 35),
      note: `Cena zmieniła się o ${signals.momentum20.toFixed(1)}% przez ostatnie 20 sesji.`,
    });
  }

  if (signals.momentum5 !== null) {
    directional.push({
      label: "Momentum 5 sesji",
      contribution: clamp(signals.momentum5 * 1.5, -20, 20),
      note: `Krótkoterminowo ${signals.momentum5 >= 0 ? "+" : ""}${signals.momentum5.toFixed(1)}%.`,
    });
  }

  const directionalScore = clamp(
    directional.reduce((acc, d) => acc + d.contribution, 0),
    -100,
    100,
  );
  const side = Math.sign(directionalScore);

  // Rozciągnięcie: 0 = brak, 1 = skrajne. Liczone tylko w tę stronę, w
  // którą i tak wskazuje kierunek — RSI 85 przy spadkach nie tłumi niczego,
  // bo wtedy jest argumentem ZA sygnałem, nie przeciw niemu.
  const stretchParts: Array<{ label: string; amount: number; note: string }> = [];

  if (signals.rsi !== null) {
    const towards = side >= 0 ? signals.rsi - 50 : 50 - signals.rsi;
    stretchParts.push({
      label: "RSI 14",
      amount: clamp(towards / 50, 0, 1),
      note:
        signals.rsi >= 70
          ? `RSI ${signals.rsi.toFixed(0)} — wykupienie, ryzyko zadyszki mimo wzrostów.`
          : signals.rsi <= 30
            ? `RSI ${signals.rsi.toFixed(0)} — wyprzedanie, ruch w dół jest już rozciągnięty.`
            : `RSI ${signals.rsi.toFixed(0)} — bez skrajności.`,
    });
  }

  if (signals.rangePosition !== null) {
    const towards = side >= 0 ? signals.rangePosition - 50 : 50 - signals.rangePosition;
    stretchParts.push({
      label: "Pozycja w zakresie 60 sesji",
      amount: clamp(towards / 50, 0, 1),
      note: `Cena jest na ${signals.rangePosition.toFixed(0)}% zakresu z ostatnich 60 sesji.`,
    });
  }

  // Maksymalnie 45% tłumienia, rozłożone po równo na dostępne miary.
  const MAX_DAMPENING = 0.45;
  const stretch =
    stretchParts.length > 0
      ? stretchParts.reduce((acc, p) => acc + p.amount, 0) / stretchParts.length
      : 0;
  const factor = 1 - stretch * MAX_DAMPENING;
  const score = Math.round(clamp(directionalScore * factor, -100, 100));

  // Tłumienie pokazujemy jako ujemny wkład, żeby suma przesłanek zgadzała
  // się z wynikiem — panel pokazuje jedno i drugie obok siebie.
  const dampening = score - Math.round(directionalScore);
  const drivers: SignalDriver[] = [
    ...directional,
    ...stretchParts.map((part) => ({
      label: part.label,
      contribution:
        stretchParts.length > 0 && stretch > 0
          ? (dampening * part.amount) / (stretch * stretchParts.length)
          : 0,
      note: part.note,
    })),
  ];

  // Kierunek dopiero powyżej progu — „lekko dodatnia wypadkowa" to nie
  // sygnał, tylko szum, a nazwanie go wzrostem byłoby wprowadzaniem w błąd.
  const direction: SignalDirection = score >= 15 ? "up" : score <= -15 ? "down" : "flat";

  // Pewność: siła wypadkowej × zgodność przesłanek kierunkowych ×
  // dostateczność danych, pomniejszona o zmienność.
  const agreeing = directional.filter((d) => Math.sign(d.contribution) === side).length;
  const agreement = directional.length > 0 ? agreeing / directional.length : 0;
  const dataSufficiency = clamp(signals.points / 60, 0, 1);
  const volatilityPenalty = signals.volatility ? clamp(signals.volatility / 200, 0, 0.5) : 0;

  const confidence = Math.round(
    clamp(Math.abs(score) * agreement * dataSufficiency * (1 - volatilityPenalty) * 1.4, 0, 95),
  );

  return {
    signals,
    score,
    direction,
    confidence: direction === "flat" ? Math.min(confidence, 40) : confidence,
    // Najmocniejsze przesłanki najpierw — UI pokazuje trzy pierwsze.
    drivers: drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
  };
}

/**
 * Łączy ocenę techniczną z wydźwiękiem newsów.
 *
 * Waga 75/25 na korzyść liczb: wydźwięk jest wtórny wobec ceny (nagłówki
 * często opisują ruch, który już się wydarzył) i pochodzi z oceny modelu,
 * więc nie powinien przeważać nad tym, co widać w notowaniach. Gdy newsów
 * dla instrumentu nie ma, technika liczy się w całości — brak newsów nie
 * może być czytany jako sygnał neutralny ciągnący wynik do zera.
 */
export function combineOutlook(
  technical: TechnicalOutlook,
  sentimentScore: number | null,
  sentimentItems = 0,
): { score: number; direction: SignalDirection; confidence: number } {
  if (sentimentScore === null || sentimentItems === 0) {
    return {
      score: technical.score,
      direction: technical.direction,
      confidence: technical.confidence,
    };
  }

  const score = Math.round(clamp(technical.score * 0.75 + sentimentScore * 0.25, -100, 100));
  const direction: SignalDirection = score >= 15 ? "up" : score <= -15 ? "down" : "flat";

  // Zgodność techniki i newsów podnosi pewność, sprzeczność ją obniża —
  // jedno i drugie najwyżej o 10 punktów.
  const agree = Math.sign(technical.score) === Math.sign(sentimentScore) && technical.score !== 0;
  const adjusted = clamp(technical.confidence + (agree ? 10 : -10), 0, 95);

  return {
    score,
    direction,
    confidence: Math.round(direction === "flat" ? Math.min(adjusted, 40) : adjusted),
  };
}
