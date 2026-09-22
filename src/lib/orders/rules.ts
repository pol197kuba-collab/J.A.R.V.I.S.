// STAŁE ROZKAZY — czysta warstwa decyzyjna. Bez I/O, bez Supabase, bez
// wiedzy o tym, czy obserwowaną wielkością jest kurs Bitcoina, czy hurtowa
// cena oleju napędowego. Dostaje serię dziennych punktów i rozkaz, oddaje
// werdykt — dzięki temu ten sam kod obsługuje oba nocne joby i da się go
// przetestować jednostkowo, bez bazy.
//
// DLACZEGO TO NIE JEST CZĘŚĆ MODUŁU RYNKOWEGO ANI PALIWOWEGO. Moduł paliwowy
// miał już własne progi z własnym ewaluatorem, moduł rynkowy nie miał
// żadnych. Dopisanie drugiego ewaluatora obok pierwszego znaczyłoby dwie
// implementacje tego samego pojęcia — i nieuchronnie dwie różne odpowiedzi
// na pytanie „czy 'spadek o 5%' liczymy od wczoraj, czy od ostatniego
// notowania". Warunek jest jeden, więc i kod jest jeden.

export type SubjectKind = "market" | "fuel";

export type OrderCondition =
  | "level_above"
  | "level_below"
  | "change_pct_up"
  | "change_pct_down"
  | "change_abs";

export const ORDER_CONDITIONS: readonly OrderCondition[] = [
  "level_above",
  "level_below",
  "change_pct_up",
  "change_pct_down",
  "change_abs",
] as const;

/** Rozkaz w postaci, w jakiej żyje w aplikacji (kolumny z bazy, ale w camelCase). */
export type StandingOrder = {
  id: string;
  subjectKind: SubjectKind;
  subject: string;
  condition: OrderCondition;
  threshold: number;
  windowDays: number;
  cooldownHours: number;
  phrase: string | null;
  isEnabled: boolean;
  expiresAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
};

/** Dzienny punkt obserwowanej wielkości. Kształt wspólny dla obu modułów. */
export type SeriesPoint = {
  /** ISO, YYYY-MM-DD. */
  date: string;
  value: number;
};

export type OrderHit = {
  order: StandingOrder;
  /** Wartość, która wyzwoliła rozkaz, i dzień, z którego pochodzi. */
  value: number;
  valueDate: string;
  /** Punkt odniesienia dla warunków zmianowych; null dla warunków poziomu. */
  reference: number | null;
  referenceDate: string | null;
  changeAbs: number | null;
  changePct: number | null;
};

/**
 * Po ilu dniach bez nowego punktu przestajemy oceniać serię.
 *
 * Martwe źródło jest groźniejsze niż brak rozkazu: gdyby dostawca notowań
 * zamilkł, warunek „cena poniżej X" byłby spełniony w nieskończoność przez
 * ostatnią znaną cenę i meldunek wracałby co dobę, opisując przeszłość jako
 * teraźniejszość. Siedem dni pokrywa długi weekend świąteczny i przerwę w
 * publikacji cennika, a nie pokrywa awarii źródła.
 */
export const MAX_SERIES_STALENESS_DAYS = 7;

const DAY_MS = 86_400_000;

/** Liczba pełnych dni między dwiema datami ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / DAY_MS);
}

/** Rozkaz włączony i przed terminem ważności. */
export function isActive(order: StandingOrder, now: Date = new Date()): boolean {
  if (!order.isEnabled) return false;
  if (order.expiresAt && Date.parse(order.expiresAt) <= now.getTime()) return false;
  return true;
}

/**
 * Czy rozkaz jest jeszcze wyciszony po poprzednim meldunku.
 *
 * Bez tego rozkaz na poziomie ceny meldowałby to samo każdego dnia po
 * przekroczeniu progu — warunek „ON poniżej 5200" pozostaje przecież
 * prawdziwy również jutro. Wyciszenie liczymy od chwili meldunku, nie od
 * początku doby, żeby „raz dziennie" znaczyło to samo niezależnie od tego,
 * o której job się uruchomił.
 */
export function isSilenced(order: StandingOrder, now: Date = new Date()): boolean {
  if (!order.lastTriggeredAt) return false;
  const since = now.getTime() - Date.parse(order.lastTriggeredAt);
  if (Number.isNaN(since)) return false;
  return since < order.cooldownHours * 3600_000;
}

/** Porządkuje serię rosnąco po dacie i odrzuca punkty bez sensownej wartości. */
export function normalizePoints(points: SeriesPoint[]): SeriesPoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    byDate.set(p.date, p.value);
  }
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Sprawdza jeden rozkaz przeciwko jednej serii.
 *
 * Zwraca `null`, gdy rozkaz się NIE wyzwala — i celowo nie rozróżnia „warunek
 * niespełniony" od „nie ma z czego liczyć". Wołający nie ma z tą różnicą co
 * zrobić: w obu wypadkach nie melduje.
 *
 * Wyciszenie i termin ważności sprawdzamy tutaj, a nie u wołającego, żeby nie
 * dało się ich pominąć przez przeoczenie w jednym z dwóch jobów.
 */
export function evaluateOrder(
  order: StandingOrder,
  points: SeriesPoint[],
  now: Date = new Date(),
): OrderHit | null {
  if (!isActive(order, now) || isSilenced(order, now)) return null;

  const series = normalizePoints(points);
  const latest = series[series.length - 1];
  if (!latest) return null;

  // Seria, która przestała się aktualizować, nie opisuje już teraźniejszości.
  const today = new Date(now.getTime()).toISOString().slice(0, 10);
  const age = daysBetween(latest.date, today);
  if (Number.isFinite(age) && age > MAX_SERIES_STALENESS_DAYS) return null;

  if (order.condition === "level_above" || order.condition === "level_below") {
    const triggered =
      order.condition === "level_above"
        ? latest.value >= order.threshold
        : latest.value <= order.threshold;
    if (!triggered) return null;
    return {
      order,
      value: latest.value,
      valueDate: latest.date,
      reference: null,
      referenceDate: null,
      changeAbs: null,
      changePct: null,
    };
  }

  // Warunki zmianowe potrzebują punktu odniesienia sprzed okna. Bierzemy
  // OSTATNI punkt nie młodszy niż początek okna — przy notowaniach dziennych
  // z lukami (weekend, święto) „wczoraj" bywa sprzed trzech dni i to właśnie
  // ten punkt jest uczciwym odniesieniem, a nie brak wyniku.
  const cutoff = new Date(Date.parse(`${latest.date}T00:00:00Z`) - order.windowDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  let reference: SeriesPoint | undefined;
  for (const p of series) {
    if (p.date <= cutoff) reference = p;
    else break;
  }
  if (!reference || !(reference.value > 0)) return null;

  const changeAbs = latest.value - reference.value;
  const changePct = (changeAbs / reference.value) * 100;

  const triggered =
    order.condition === "change_pct_up"
      ? changePct >= order.threshold
      : order.condition === "change_pct_down"
        ? changePct <= -order.threshold
        : Math.abs(changeAbs) >= order.threshold;

  if (!triggered) return null;

  return {
    order,
    value: latest.value,
    valueDate: latest.date,
    reference: reference.value,
    referenceDate: reference.date,
    changeAbs,
    changePct,
  };
}

/** Etykiety potrzebne do złożenia meldunku po ludzku. */
export type SubjectLabels = {
  /** Nazwa czytelna dla człowieka, np. „Bitcoin" albo „ON Ekodiesel". */
  label: string;
  /** Jednostka wartości, np. „USD" albo „PLN/m³". */
  unit: string;
};

/**
 * Liczba w meldunku: bez zbędnych zer, ale bez gubienia groszy.
 *
 * Formatujemy RĘCZNIE, a nie przez `toLocaleString("pl-PL")`, bo ten sam kod
 * biegnie w przeglądarce i w nocnym jobie na GitHub Actions, gdzie Node bywa
 * zbudowany z okrojonym ICU — tam „5200" nie dostaje spacji tysięcznej i ten
 * sam meldunek wygląda inaczej w zależności od tego, kto go złożył.
 * Separatorem jest spacja nierozdzielająca, żeby liczba nie łamała się w pół
 * na końcu wiersza.
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

const pct = (value: number): string => `${value > 0 ? "+" : ""}${money(round2(value))}%`;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Opis rozkazu jednym zdaniem — ten sam tekst idzie na listę w panelu i do
 * potwierdzenia, które agent wypowiada po założeniu rozkazu.
 */
export function describeOrder(order: StandingOrder, labels: SubjectLabels): string {
  const window = order.windowDays === 1 ? "w ciągu dnia" : `w ciągu ${order.windowDays} dni`;
  switch (order.condition) {
    case "level_above":
      return `${labels.label} powyżej ${money(order.threshold)} ${labels.unit}`;
    case "level_below":
      return `${labels.label} poniżej ${money(order.threshold)} ${labels.unit}`;
    case "change_pct_up":
      return `${labels.label} w górę o ${money(order.threshold)}% ${window}`;
    case "change_pct_down":
      return `${labels.label} w dół o ${money(order.threshold)}% ${window}`;
    case "change_abs":
      return `${labels.label} zmiana o ${money(order.threshold)} ${labels.unit} ${window}`;
  }
}

/**
 * Meldunek o wyzwoleniu: tytuł do dzwonka i treść.
 *
 * Zdanie, którym rozkaz został zamówiony, dopisujemy na końcu, jeśli jest.
 * Użytkownik pamięta, co powiedział — nie musi tłumaczyć „ON change_abs 120"
 * z powrotem na własne słowa.
 */
export function formatHit(hit: OrderHit, labels: SubjectLabels): { title: string; body: string } {
  const { order } = hit;
  const value = `${money(hit.value)} ${labels.unit}`;
  const title = `${labels.label}: ${
    order.condition === "level_above"
      ? "próg przekroczony"
      : order.condition === "level_below"
        ? "cena poniżej progu"
        : "ruch ceny"
  }`;

  const parts: string[] = [];
  if (hit.changePct !== null && hit.reference !== null) {
    parts.push(
      `${value} — ${pct(hit.changePct)} (${hit.changeAbs !== null && hit.changeAbs > 0 ? "+" : ""}` +
        `${money(hit.changeAbs ?? 0)} ${labels.unit}) od ${hit.referenceDate}.`,
    );
  } else {
    parts.push(`${value} na ${hit.valueDate}.`);
  }
  parts.push(`Rozkaz: ${describeOrder(order, labels)}.`);
  if (order.phrase) parts.push(`„${order.phrase}"`);

  return { title, body: parts.join(" ") };
}
