import { describe, expect, it } from "vitest";
import {
  changePct,
  monthLabel,
  monthlyTotals,
  shiftMonth,
  summarizeMonth,
  type ExpenseRow,
} from "./summary";

const row = (p: Partial<ExpenseRow>): ExpenseRow => ({
  id: Math.random().toString(36),
  merchant: "Lidl",
  spentOn: "2026-10-05",
  total: 0,
  currency: "PLN",
  hasPhoto: false,
  items: [],
  ...p,
});

describe("months", () => {
  it("shifts across years and names months in Polish", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -13)).toBe("2025-09");
    expect(monthLabel("2026-10")).toBe("październik 2026");
  });
});

describe("summarizeMonth", () => {
  const rows = [
    row({
      total: 30,
      items: [
        { name: "Chleb", qty: 1, price: 10, category: "zywnosc" },
        { name: "Płyn", qty: 1, price: 15, category: "chemia" },
        { name: "Rabat", qty: 1, price: -2, category: "inne" },
      ],
    }),
    row({ merchant: "Orlen", total: 200 }),
    row({
      merchant: " Lidl ",
      total: 20,
      items: [{ name: "Ser", qty: 1, price: 20, category: "zywnosc" }],
    }),
    row({ merchant: "Zara", total: 50, currency: "EUR" }),
    row({ spentOn: "2026-09-30", total: 999 }),
  ];
  const s = summarizeMonth(rows, "2026-10");

  it("sums PLN only and keeps other currencies apart", () => {
    expect(s.total).toBe(250);
    expect(s.count).toBe(3);
    expect(s.other).toEqual([{ currency: "EUR", total: 50, count: 1 }]);
  });

  it("splits by category so the parts add up to the total", () => {
    expect(s.categories).toEqual([
      { category: "inne", amount: 205 }, // Orlen without items + rabat -2 + remainder 7
      { category: "zywnosc", amount: 30 },
      { category: "chemia", amount: 15 },
    ]);
    expect(s.categories.reduce((a, c) => a + c.amount, 0)).toBe(s.total);
  });

  it("ranks merchants (trimmed names merge)", () => {
    expect(s.merchants[0]).toEqual({ merchant: "Orlen", amount: 200, count: 1 });
    expect(s.merchants[1]).toEqual({ merchant: "Lidl", amount: 50, count: 2 });
  });
});

describe("monthlyTotals / changePct", () => {
  it("fills empty months with zero, oldest first", () => {
    const t = monthlyTotals(
      [row({ total: 10 }), row({ spentOn: "2026-08-01", total: 5 })],
      "2026-10",
      3,
    );
    expect(t).toEqual([
      { month: "2026-08", total: 5 },
      { month: "2026-09", total: 0 },
      { month: "2026-10", total: 10 },
    ]);
    expect(changePct(110, 100)).toBeCloseTo(10);
    expect(changePct(10, 0)).toBeNull();
  });
});
