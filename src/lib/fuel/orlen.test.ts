import { describe, expect, it } from "vitest";
import { buildOrlenUrl, fillGaps, parseOrlenResponse, productById } from "./orlen";

const ON = productById(43)!;
const PB95 = productById(41)!;

// Fragment realnej odpowiedzi API (zweryfikowany 19.09.2026) — malejąco
// po dacie, `value` z częścią dziesiętną, `unit` czasem null.
const REAL_ON = [
  {
    productName: "ONEkodiesel",
    effectiveDate: "2026-09-19T00:00:00",
    publishFrom: "2026-09-19T00:00:00",
    value: 7522.0,
    locationName: "",
    locationSymbol: "",
    unit: null,
  },
  {
    productName: "ONEkodiesel",
    effectiveDate: "2026-09-18T00:00:00",
    publishFrom: "2026-09-18T00:00:00",
    value: 7505.0,
    unit: null,
  },
  {
    productName: "ONEkodiesel",
    effectiveDate: "2026-09-17T00:00:00",
    publishFrom: "2026-09-17T00:00:00",
    value: 7563.0,
    unit: null,
  },
];

describe("buildOrlenUrl", () => {
  it("składa adres z productId i zakresem dat", () => {
    expect(buildOrlenUrl(43, "2026-09-01", "2026-09-19")).toBe(
      "https://tool.orlen.pl/api/wholesalefuelprices/ByProduct?productId=43&from=2026-09-01&to=2026-09-19",
    );
  });
});

describe("parseOrlenResponse", () => {
  it("zwraca punkty posortowane rosnąco po dacie", () => {
    const { prices, rejected } = parseOrlenResponse(REAL_ON, ON);
    expect(rejected).toHaveLength(0);
    expect(prices.map((p) => p.date)).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(prices.map((p) => p.price)).toEqual([7563, 7505, 7522]);
    expect(prices.every((p) => p.productId === 43 && p.productCode === "ON")).toBe(true);
    expect(prices.every((p) => p.isGapFill === false)).toBe(true);
  });

  it("odrzuca wiersze innego produktu zamiast je przepuszczać", () => {
    const { prices, rejected } = parseOrlenResponse(REAL_ON, PB95);
    expect(prices).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    expect(rejected[0].reason).toContain("productName");
  });

  it("odrzuca złe daty, ceny spoza widełek i nie-obiekty", () => {
    const { prices, rejected } = parseOrlenResponse(
      [
        { productName: "ONEkodiesel", effectiveDate: "wczoraj", value: 7000 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-10T00:00:00", value: 0 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-11T00:00:00", value: 99_999 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-12T00:00:00", value: "brak" },
        null,
        { productName: "ONEkodiesel", effectiveDate: "2026-09-13T00:00:00", value: 7100 },
      ],
      ON,
    );
    expect(prices).toEqual([
      { productId: 43, productCode: "ON", date: "2026-09-13", price: 7100, isGapFill: false },
    ]);
    expect(rejected).toHaveLength(5);
  });

  it("scala zgodne duplikaty, a sprzeczne usuwa w całości", () => {
    const { prices } = parseOrlenResponse(
      [
        { productName: "ONEkodiesel", effectiveDate: "2026-09-10T00:00:00", value: 7000 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-10T00:00:00", value: 7000 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-11T00:00:00", value: 7100 },
        { productName: "ONEkodiesel", effectiveDate: "2026-09-11T00:00:00", value: 7200 },
      ],
      ON,
    );
    expect(prices.map((p) => p.date)).toEqual(["2026-09-10"]);
  });

  it("nie wywraca się na odpowiedzi, która nie jest tablicą", () => {
    expect(parseOrlenResponse({ error: "nope" }, ON).prices).toHaveLength(0);
  });
});

describe("fillGaps", () => {
  it("domyka dni bez publikacji ceną z ostatniego notowania", () => {
    // Realna luka z września 2026: brak publikacji 13-14.
    const filled = fillGaps([
      { productId: 43, productCode: "ON", date: "2026-09-12", price: 7400, isGapFill: false },
      { productId: 43, productCode: "ON", date: "2026-09-15", price: 7480, isGapFill: false },
    ]);
    expect(filled.map((p) => [p.date, p.price, p.isGapFill])).toEqual([
      ["2026-09-12", 7400, false],
      ["2026-09-13", 7400, true],
      ["2026-09-14", 7400, true],
      ["2026-09-15", 7480, false],
    ]);
  });

  it("dociąga serię do wskazanego dnia, gdy cennik jeszcze nie wyszedł", () => {
    const filled = fillGaps(
      [{ productId: 41, productCode: "PB95", date: "2026-09-18", price: 6366, isGapFill: false }],
      "2026-09-20",
    );
    expect(filled).toHaveLength(3);
    expect(filled[2]).toEqual({
      productId: 41,
      productCode: "PB95",
      date: "2026-09-20",
      price: 6366,
      isGapFill: true,
    });
  });

  it("ignoruje `until` wcześniejszy niż ostatni punkt", () => {
    const filled = fillGaps(
      [{ productId: 43, productCode: "ON", date: "2026-09-18", price: 7505, isGapFill: false }],
      "2026-09-01",
    );
    expect(filled).toHaveLength(1);
  });

  it("zwraca pustą tablicę dla pustego wejścia", () => {
    expect(fillGaps([])).toEqual([]);
  });
});
