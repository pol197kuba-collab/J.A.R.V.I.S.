// Ponawianie zaciągu cen — test napisany pod KONKRETNĄ awarię.
//
// Nocny job padał praktycznie co noc, choć nic nie było zepsute: z pięciu
// paliw trzy zaciągały się poprawnie, a jedno–dwa wracały z „fetch failed",
// za każdym razem inne. Cały przebieg kończył się kodem 1, mimo że rynek,
// newsy i alerty przechodziły. Przyczyna: ani jednej ponowionej próby.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProductPrices, isRetriableFetchError } from "./ingest.server";
import { ORLEN_PRODUCTS } from "./orlen";

const DIESEL = ORLEN_PRODUCTS.find((p) => p.code === "ON")!;

/** Odpowiedź Orlenu w kształcie, który przechodzi przez parser. */
const okPayload = () => [
  {
    productName: DIESEL.apiName,
    effectiveDate: "2026-09-19T00:00:00",
    publishFrom: "2026-09-19T00:00:00",
    value: 5432.0,
  },
];

const okResponse = () => ({ ok: true, status: 200, json: async () => okPayload() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("zaciąg cen — ponawianie", () => {
  it("recovers from a transient network failure instead of losing the product", async () => {
    // Dokładnie objaw z produkcji: „fetch failed" bez odpowiedzi HTTP.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProductPrices(DIESEL, "2026-09-14", "2026-09-21");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.points).toHaveLength(1);
  });

  it("gives up after a bounded number of attempts rather than hanging on", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProductPrices(DIESEL, "2026-09-14", "2026-09-21")).rejects.toThrow();
    // Ponawianie bez granicy zamieniłoby awarię sieci w wiszący job.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 404 — that answer will not change", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProductPrices(DIESEL, "2026-09-14", "2026-09-21")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503, because that one is worth asking again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProductPrices(DIESEL, "2026-09-14", "2026-09-21");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.points).toHaveLength(1);
  });
});

describe("isRetriableFetchError", () => {
  it("treats a transport failure as worth retrying", () => {
    expect(isRetriableFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetriableFetchError(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });
});
