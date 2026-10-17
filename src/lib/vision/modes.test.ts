import { describe, expect, it } from "vitest";
import {
  ReceiptSchema,
  itemsSum,
  normalizeDocument,
  normalizeFridge,
  normalizeOdometer,
  normalizeReceipt,
  parseAmount,
  parseDate,
  receiptWarnings,
} from "./modes";

describe("parseAmount", () => {
  it("reads Polish and English money formats", () => {
    expect(parseAmount("12,99 zł")).toBe(12.99);
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("-3,00")).toBe(-3);
    expect(parseAmount(7.456)).toBe(7.46);
    expect(parseAmount("123 456 km")).toBe(123456);
    expect(parseAmount("123.456")).toBe(123456);
    expect(parseAmount("brak")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts common receipt formats and rejects impossible dates", () => {
    expect(parseDate("2026-10-17")).toBe("2026-10-17");
    expect(parseDate("17.10.2026 14:03")).toBe("2026-10-17");
    expect(parseDate("17-10-26")).toBe("2026-10-17");
    expect(parseDate("2026/1/5")).toBe("2026-01-05");
    expect(parseDate("31.02.2026")).toBe("");
    expect(parseDate(null)).toBe("");
  });
});

describe("normalizeReceipt", () => {
  const raw = {
    merchant: "  Biedronka  ",
    date: "17.10.2026",
    total: "23,47",
    currency: "pln",
    items: [
      { name: "Mleko 2%", qty: 2, price: "7,98", category: "zywnosc" },
      { name: "Płyn do naczyń", qty: null, price: 9.99, category: "Chemia" },
      { name: "Rabat", qty: 1, price: "-1,50", category: "???" },
      { name: "  ", price: 1 },
      { name: "Bułka", qty: 0, price: 7, category: "zywnosc" },
    ],
  };

  it("cleans the model's answer into an editable draft", () => {
    const d = normalizeReceipt(raw);
    expect(d.merchant).toBe("Biedronka");
    expect(d.date).toBe("2026-10-17");
    expect(d.total).toBe(23.47);
    expect(d.currency).toBe("PLN");
    expect(d.items.map((i) => i.name)).toEqual(["Mleko 2%", "Płyn do naczyń", "Rabat", "Bułka"]);
    expect(d.items[1]).toMatchObject({ qty: 1, category: "chemia" });
    expect(d.items[2]).toMatchObject({ price: -1.5, category: "inne" });
    expect(d.items[3].qty).toBe(1);
    expect(
      normalizeReceipt({ items: [{ name: "Jabłka", qty: "1,235", price: 6.17 }] }).items[0].qty,
    ).toBe(1.235);
  });

  it("falls back to the items' sum when the total is unreadable", () => {
    const d = normalizeReceipt({ ...raw, total: null });
    expect(d.total).toBe(itemsSum(d.items));
    expect(normalizeReceipt({}).total).toBeNull();
    expect(normalizeReceipt("garbage").items).toEqual([]);
  });

  it("flags what the user should check before saving", () => {
    const d = normalizeReceipt(raw);
    expect(receiptWarnings(d, "2026-10-17")).toEqual([]);
    const off = { ...d, total: 30 };
    expect(receiptWarnings(off, "2026-10-17")[0]).toContain("różnica");
    expect(receiptWarnings({ ...d, date: "2026-12-01" }, "2026-10-17")).toContain(
      "Data jest z przyszłości.",
    );
    const empty = normalizeReceipt({});
    expect(receiptWarnings(empty, "2026-10-17")).toEqual([
      "Brak nazwy sklepu.",
      "Nie odczytałem daty.",
      "Nie odczytałem sumy.",
      "Brak pozycji — zapiszesz samą sumę.",
    ]);
  });

  it("a complete draft passes the strict save schema, an incomplete one does not", () => {
    const d = normalizeReceipt(raw);
    expect(ReceiptSchema.safeParse(d).success).toBe(true);
    expect(ReceiptSchema.safeParse(normalizeReceipt({})).success).toBe(false);
  });
});

describe("other modes", () => {
  it("odometer keeps whole km and drops nonsense", () => {
    expect(
      normalizeOdometer({ odometerKm: "123 456,7", fuelLiters: "41,2", amountPln: "263,27 zł" }),
    ).toEqual({
      odometerKm: 123457,
      fuelLiters: 41.2,
      amountPln: 263.27,
      note: "",
    });
    expect(normalizeOdometer({ odometerKm: -5, fuelLiters: 0 })).toEqual({
      odometerKm: null,
      fuelLiters: null,
      amountPln: null,
      note: "",
    });
  });

  it("document gets a default type, fridge drops a recipe without steps", () => {
    expect(normalizeDocument({ title: "Umowa", text: "  a\n\nb " })).toEqual({
      title: "Umowa",
      docType: "dokument",
      summary: "",
      text: "a\n\nb",
    });
    expect(
      normalizeFridge({ products: ["jajka", "", 3], recipe: { title: "Jajecznica" } }),
    ).toEqual({ products: ["jajka"], recipe: null });
  });
});

describe("countEdits", () => {
  it("counts changed leaves and added/removed entries", async () => {
    const { countEdits } = await import("./modes");
    const a = {
      merchant: "Lidl",
      total: 10,
      items: [
        { name: "a", price: 1 },
        { name: "b", price: 2 },
      ],
    };
    expect(countEdits(a, a)).toBe(0);
    expect(countEdits(a, { ...a, merchant: "LIDL" })).toBe(1);
    expect(countEdits(a, { ...a, items: [{ name: "a", price: 1.5 }] })).toBe(2);
    expect(countEdits({ note: "" }, { note: null })).toBe(0);
  });
});
