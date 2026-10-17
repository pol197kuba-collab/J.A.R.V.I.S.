// WYDATKI (S4.2) — month sums and the category split. Pure: rows in,
// what /wydatki shows out. Only PLN goes into the sums; receipts in another
// currency are counted separately (no FX guesswork).

import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/vision/modes";

export type ExpenseItemRow = {
  name: string;
  qty: number;
  price: number;
  category: ExpenseCategory;
};

export type ExpenseRow = {
  id: string;
  merchant: string;
  spentOn: string; // YYYY-MM-DD
  total: number;
  currency: string;
  hasPhoto: boolean;
  items: ExpenseItemRow[];
};

/** "2026-10-17" → "2026-10". */
export const monthOf = (day: string) => day.slice(0, 7);

/** "2026-01" shifted by -1 → "2025-12". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const MONTHS = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];
export const monthLabel = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const monthShort = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1].slice(0, 3);

const r2 = (v: number) => Math.round(v * 100) / 100;

export type MonthSummary = {
  month: string;
  /** PLN only. */
  total: number;
  count: number;
  /** Category split of the PLN total, biggest first; sums to `total`. */
  categories: { category: ExpenseCategory; amount: number }[];
  merchants: { merchant: string; amount: number; count: number }[];
  /** Receipts in other currencies, summed per currency. */
  other: { currency: string; total: number; count: number }[];
};

export function summarizeMonth(rows: readonly ExpenseRow[], month: string): MonthSummary {
  const inMonth = rows.filter((r) => monthOf(r.spentOn) === month);
  const pln = inMonth.filter((r) => r.currency === "PLN");
  const cat = new Map<ExpenseCategory, number>();
  const shops = new Map<string, { amount: number; count: number }>();
  for (const r of pln) {
    let itemsSum = 0;
    for (const it of r.items) {
      cat.set(it.category, (cat.get(it.category) ?? 0) + it.price);
      itemsSum += it.price;
    }
    // Whatever the items don't explain (no items read, rounding, a missed
    // line) still counts — as "inne", so the split adds up to the total.
    const rest = r.total - itemsSum;
    if (Math.abs(rest) >= 0.005) cat.set("inne", (cat.get("inne") ?? 0) + rest);
    const key = r.merchant.trim();
    const s = shops.get(key) ?? { amount: 0, count: 0 };
    shops.set(key, { amount: s.amount + r.total, count: s.count + 1 });
  }
  const other = new Map<string, { total: number; count: number }>();
  for (const r of inMonth.filter((x) => x.currency !== "PLN")) {
    const o = other.get(r.currency) ?? { total: 0, count: 0 };
    other.set(r.currency, { total: o.total + r.total, count: o.count + 1 });
  }
  return {
    month,
    total: r2(pln.reduce((s, r) => s + r.total, 0)),
    count: pln.length,
    categories: EXPENSE_CATEGORIES.map((c) => ({ category: c, amount: r2(cat.get(c) ?? 0) }))
      .filter((c) => Math.abs(c.amount) >= 0.005)
      .sort((a, b) => b.amount - a.amount),
    merchants: [...shops]
      .map(([merchant, s]) => ({ merchant, amount: r2(s.amount), count: s.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    other: [...other].map(([currency, o]) => ({ currency, total: r2(o.total), count: o.count })),
  };
}

/** PLN totals of the `n` months ending with `month`, oldest first. */
export function monthlyTotals(
  rows: readonly ExpenseRow[],
  month: string,
  n: number,
): { month: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows)
    if (r.currency === "PLN")
      sums.set(monthOf(r.spentOn), (sums.get(monthOf(r.spentOn)) ?? 0) + r.total);
  return Array.from({ length: n }, (_, i) => {
    const m = shiftMonth(month, i - n + 1);
    return { month: m, total: r2(sums.get(m) ?? 0) };
  });
}

/** Month-on-month change in %, null when last month had nothing to compare. */
export function changePct(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}
