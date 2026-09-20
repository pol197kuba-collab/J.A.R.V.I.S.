// Publiczne API cennika hurtowego Orlenu — czysta warstwa: budowa URL-a,
// walidacja odpowiedzi i uzupełnianie luk. Zero I/O i zero Supabase, żeby
// całość dało się przetestować vitestem (environment: node) i żeby ten sam
// kod obsługiwał zarówno server function, jak i nocny job GitHub Actions.
//
// Endpoint (zweryfikowany 19.09.2026):
//   GET https://tool.orlen.pl/api/wholesalefuelprices/ByProduct
//       ?productId=43&from=2026-09-01&to=2026-09-19
// Odpowiedź: tablica posortowana MALEJĄCO po dacie, `value` w PLN/m³ netto.
// Brak nagłówka Access-Control-Allow-Origin — stąd wymóg wołania po stronie
// serwera (patrz src/lib/geo/flightRadar.ts, ten sam powód).

export const ORLEN_API_BASE = "https://tool.orlen.pl/api/wholesalefuelprices/ByProduct";

/** Najstarsza data, jaką zwraca API (sprawdzone: ON Ekodiesel od 2004-01-01). */
export const ORLEN_HISTORY_START = "2004-01-01";

export type OrlenProduct = {
  /** productId w API Orlenu. */
  id: number;
  /** Krótki kod używany w UI i w kolumnie product_code. */
  code: string;
  /** `productName` zwracane przez API — służy do odrzucania pomyłek. */
  apiName: string;
  label: string;
  /**
   * Token koloru z src/styles.css (--fuel-1..5). Przypisany na stałe do
   * produktu, nie do pozycji na liście — ukrycie serii nie przemalowuje
   * pozostałych.
   */
  colorToken: string;
};

// productId 45 (Miejski Super) i 47 (Bio 100) zwracają pustą tablicę —
// pominięte świadomie, żeby nie rysować pustych kafli.
export const ORLEN_PRODUCTS: readonly OrlenProduct[] = [
  {
    id: 43,
    code: "ON",
    apiName: "ONEkodiesel",
    label: "ON Ekodiesel",
    colorToken: "var(--fuel-1)",
  },
  { id: 41, code: "PB95", apiName: "Pb95", label: "Benzyna Pb95", colorToken: "var(--fuel-2)" },
  { id: 42, code: "PB98", apiName: "Pb98", label: "Benzyna Pb98", colorToken: "var(--fuel-3)" },
  {
    id: 44,
    code: "ON_ARCTIC",
    apiName: "ONArctic2",
    label: "ON Arktyczny 2",
    colorToken: "var(--fuel-4)",
  },
  {
    id: 46,
    code: "EKOTERM",
    apiName: "OnEkoterm",
    label: "Ekoterm (opałowy)",
    colorToken: "var(--fuel-5)",
  },
] as const;

/** Domyślne paliwo modułu — to samo, które śledzi aplikacja opłaty paliwowej. */
export const DEFAULT_PRODUCT_ID = 43;

export function productById(id: number): OrlenProduct | undefined {
  return ORLEN_PRODUCTS.find((p) => p.id === id);
}

export function buildOrlenUrl(productId: number, from: string, to: string): string {
  return `${ORLEN_API_BASE}?productId=${productId}&from=${from}&to=${to}`;
}

/** Surowy rekord z API — wszystko `unknown`, bo to dane z zewnątrz. */
type RawRow = Record<string, unknown>;

export type OrlenPricePoint = {
  productId: number;
  productCode: string;
  date: string;
  price: number;
  isGapFill: boolean;
};

export type OrlenParseResult = {
  prices: OrlenPricePoint[];
  /** Odrzucone wiersze z powodem — trafiają do logu, nigdy nie znikają po cichu. */
  rejected: Array<{ row: RawRow; reason: string }>;
};

// Widełki sanity-check. Cena hurtowa w PLN/m³ historycznie mieściła się
// w 1500-9000; szerokie granice łapią zmianę jednostki albo groszówki
// wstawione zamiast złotówek, nie blokując realnych skoków rynkowych.
const PRICE_MIN = 500;
const PRICE_MAX = 19_999;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Waliduje odpowiedź API i zwraca punkty posortowane ROSNĄCO po dacie.
 * Wiersz z inną nazwą produktu, złą datą albo ceną poza widełkami jest
 * odrzucany z powodem, a nie cicho pomijany. Duplikat daty o tej samej
 * cenie jest scalany; duplikat o różnych cenach odrzuca obie wersje, bo nie
 * ma podstaw, by zgadywać, która jest prawdziwa.
 */
export function parseOrlenResponse(payload: unknown, product: OrlenProduct): OrlenParseResult {
  const rejected: OrlenParseResult["rejected"] = [];
  if (!Array.isArray(payload)) {
    return { prices: [], rejected: [{ row: {}, reason: "payload is not an array" }] };
  }

  const byDate = new Map<string, number>();
  const conflicting = new Set<string>();

  for (const item of payload) {
    if (typeof item !== "object" || item === null) {
      rejected.push({ row: {}, reason: "row is not an object" });
      continue;
    }
    const row = item as RawRow;

    if (row.productName !== product.apiName) {
      rejected.push({ row, reason: `unexpected productName (want ${product.apiName})` });
      continue;
    }

    const effective = typeof row.effectiveDate === "string" ? row.effectiveDate.slice(0, 10) : "";
    if (!ISO_DATE.test(effective)) {
      rejected.push({ row, reason: "unparseable effectiveDate" });
      continue;
    }

    const value = typeof row.value === "number" ? row.value : Number(row.value);
    if (!Number.isFinite(value) || value < PRICE_MIN || value > PRICE_MAX) {
      rejected.push({ row, reason: "value out of range" });
      continue;
    }
    const price = Math.round(value * 100) / 100;

    const seen = byDate.get(effective);
    if (seen !== undefined && seen !== price) {
      conflicting.add(effective);
      rejected.push({ row, reason: "conflicting duplicate for date" });
      continue;
    }
    byDate.set(effective, price);
  }

  for (const date of conflicting) byDate.delete(date);

  const prices = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({
      productId: product.id,
      productCode: product.code,
      date,
      price,
      isGapFill: false,
    }));

  return { prices, rejected };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Uzupełnia dni bez publikacji (weekendy, święta) ceną z ostatniego dnia
 * notowanego, oznaczając je `isGapFill`. Dzięki temu wykres i statystyki
 * operują na ciągłej serii dziennej, a analizy, które muszą liczyć tylko
 * realne publikacje, mogą te punkty odfiltrować.
 *
 * `until` (domyślnie data ostatniego punktu) pozwala dociągnąć serię do
 * dzisiaj, gdy Orlen jeszcze nie opublikował dzisiejszego cennika.
 */
export function fillGaps(points: OrlenPricePoint[], until?: string): OrlenPricePoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const end = until && until > last.date ? until : last.date;

  const out: OrlenPricePoint[] = [];
  let cursor = sorted[0].date;
  let index = 0;
  let carried = sorted[0];

  while (cursor <= end) {
    if (index < sorted.length && sorted[index].date === cursor) {
      carried = sorted[index];
      out.push(carried);
      index += 1;
    } else {
      out.push({ ...carried, date: cursor, isGapFill: true });
    }
    cursor = addDays(cursor, 1);
  }

  return out;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
