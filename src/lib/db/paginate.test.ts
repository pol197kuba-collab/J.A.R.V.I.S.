import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, PAGE_SIZE, type PageResult } from "./paginate";

// Regresja na realną awarię: moduł /paliwa pokazywał serię urwaną
// 7 kwietnia 2026, choć w bazie były dane do września. Domyślny widok prosi
// o 365 dni pięciu paliw = 1825 wierszy, Supabase oddał pierwsze 1000
// (= 200 dni × 5 paliw, czyli dokładnie do 7 kwietnia) i NIE zgłosił błędu.
// Cichy limit strony jest tu jedynym mechanizmem wartym testu.

/** Źródło oddające `total` kolejnych liczb, stronami po `pageSize`. */
function pagedSource(total: number, pageSize = PAGE_SIZE) {
  const all = Array.from({ length: total }, (_, i) => i);
  return vi.fn(
    (from: number, to: number): Promise<PageResult<number>> =>
      Promise.resolve({ data: all.slice(from, to + 1), error: null }),
  );
}

describe("fetchAllPages", () => {
  it("składa serię dłuższą niż jedna strona", async () => {
    const page = pagedSource(1825, 1000);
    const rows = await fetchAllPages(page, 1000);

    expect(rows).toHaveLength(1825);
    expect(rows[0]).toBe(0);
    expect(rows[1824]).toBe(1824);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("prosi o właściwe, domknięte obustronnie zakresy", async () => {
    const page = pagedSource(2500, 1000);
    await fetchAllPages(page, 1000);

    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("kończy na niepełnej stronie, bez zbędnego zapytania", async () => {
    const page = pagedSource(150, 1000);
    const rows = await fetchAllPages(page, 1000);

    expect(rows).toHaveLength(150);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("radzi sobie z liczbą wierszy równą wielokrotności strony", async () => {
    const page = pagedSource(2000, 1000);
    const rows = await fetchAllPages(page, 1000);

    // Dwie pełne strony nie mówią jeszcze, że to koniec — trzecia wraca
    // pusta i dopiero ona kończy pętlę.
    expect(rows).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("zwraca pustą tablicę dla pustego źródła", async () => {
    const page = pagedSource(0, 1000);
    await expect(fetchAllPages(page, 1000)).resolves.toEqual([]);
  });

  it("przerywa i rzuca, gdy strona zwróci błąd", async () => {
    const page = vi.fn((from: number): Promise<PageResult<number>> => {
      if (from === 0) return Promise.resolve({ data: [1, 2], error: null });
      return Promise.resolve({ data: null, error: { message: "statement timeout" } });
    });

    await expect(fetchAllPages(page, 2)).rejects.toThrow("statement timeout");
  });

  it("nie kręci się w nieskończoność, gdy źródło zawsze oddaje pełną stronę", async () => {
    const page = vi.fn(
      (): Promise<PageResult<number>> => Promise.resolve({ data: [1, 2], error: null }),
    );

    const rows = await fetchAllPages(page, 2);
    expect(page.mock.calls.length).toBeLessThanOrEqual(50);
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});
