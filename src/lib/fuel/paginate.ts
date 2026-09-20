// Odczyt serii dłuższych niż limit wierszy PostgREST.
//
// Supabase domyślnie zwraca maksymalnie 1000 wierszy na zapytanie
// (Settings → API → Max rows) i robi to CICHO: nadmiar znika, `error`
// zostaje `null`. Dla tego modułu to trafia w samo sedno — rok historii
// pięciu paliw to 1825 wierszy, a pięć lat ponad 9000. Bez stronicowania
// wykres pokazywał pierwsze 1000 wierszy, czyli — przy sortowaniu rosnącym
// — najstarsze 200 dni, i wyglądał jakby dane urwały się pół roku temu.
//
// Stąd ten helper: pobiera kolejne strony `.range()`, aż strona wróci
// niepełna.

/** Domyślny limit wierszy w Supabase; strona nie może być większa. */
export const PAGE_SIZE = 1000;

// Bezpiecznik na wypadek źródła, które zawsze oddaje pełną stronę (np. gdy
// zapytanie ma niestabilne sortowanie). 50 stron to 50 tys. wierszy —
// grubo powyżej ~40 tys., jakie daje pełna historia pięciu paliw od 2004.
const MAX_PAGES = 50;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Składa wszystkie strony w jedną tablicę.
 *
 * `page` dostaje indeksy do `.range(from, to)` — WŁĄCZNIE po obu stronach,
 * tak jak w supabase-js.
 *
 * UWAGA przy wywołaniu: zapytanie musi mieć **jednoznaczne sortowanie**.
 * Samo `.order("price_date")` nie wystarcza, gdy tę samą datę ma pięć
 * produktów — kolejność wierszy w obrębie daty nie jest wtedy określona
 * i przy podziale na strony wiersze potrafią się powtórzyć albo zniknąć.
 * Dlatego każde użycie dokłada drugi klucz sortowania.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];

  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    out.push(...rows);

    // Niepełna strona znaczy koniec danych. Pełna strona przy ostatnim
    // wierszu to przypadek graniczny: kolejna pętla zwróci zero wierszy
    // i wyjdziemy tutaj.
    if (rows.length < pageSize) return out;
  }

  return out;
}
