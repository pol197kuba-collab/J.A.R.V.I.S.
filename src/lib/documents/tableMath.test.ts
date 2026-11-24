import { describe, expect, it } from "vitest";
import { analyzeTable, parseNumber, resolveColumn } from "./tableMath";

const T = [
  ["Data", "Kategoria", "Kwota"],
  ["2026-01", "Paliwo", "250,50 zł"],
  ["2026-01", "Jedzenie", "1 200,00 zł"],
  ["2026-02", "Paliwo", "300"],
  ["2026-02", "Jedzenie", "980,5"],
  ["2026-02", "Pies", "—"],
];

describe("parseNumber", () => {
  it("polski i angielski zapis, waluty, procenty", () => {
    expect(parseNumber("1 234,56 zł")).toBe(1234.56);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("-12%")).toBe(-12);
    expect(parseNumber("PLN 99")).toBe(99);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("2026-01")).toBeNull();
  });
});

describe("resolveColumn", () => {
  it("po nazwie (bez wielkości liter i ogonków), fragmencie i literze", () => {
    const h = ["Data", "Kategoria", "Kwota zł"];
    expect(resolveColumn(h, "kategoria")).toBe(1);
    expect(resolveColumn(h, "kwota")).toBe(2);
    expect(resolveColumn(h, "C")).toBe(2);
    expect(resolveColumn(h, "nie ma")).toBeNull();
  });
});

describe("analyzeTable", () => {
  it("describe: typy kolumn, sumy i najczęstsze wartości", () => {
    const r = analyzeTable(T, { operation: "describe" }) as {
      rows: number;
      columns: Array<Record<string, unknown>>;
    };
    expect(r.rows).toBe(5);
    expect(r.columns[2]).toMatchObject({ name: "Kwota", type: "number", sum: 2731, max: 1200 });
    expect(r.columns[1]).toMatchObject({ type: "text", distinct: 3 });
  });

  it("aggregate: suma po kategorii, malejąco; nieliczbowe pominięte i policzone", () => {
    const r = analyzeTable(T, {
      operation: "aggregate",
      group_by: "Kategoria",
      value_column: "Kwota",
      agg: "sum",
    }) as { groups: Array<{ key: string; value: number }>; non_numeric_skipped: number };
    expect(r.groups.map((g) => [g.key, g.value])).toEqual([
      ["Jedzenie", 2180.5],
      ["Paliwo", 550.5],
      ["Pies", null],
    ]);
    expect(r.non_numeric_skipped).toBe(1);
  });

  it("trend: grupowanie po dacie, sort po kluczu, z filtrem", () => {
    const r = analyzeTable(T, {
      operation: "aggregate",
      group_by: "Data",
      value_column: "Kwota",
      agg: "sum",
      sort: "key",
      filters: [{ column: "Kategoria", op: "eq", value: "paliwo" }],
    }) as { groups: Array<{ key: string; value: number }> };
    expect(r.groups).toEqual([
      { key: "2026-01", value: 250.5, rows: 1 },
      { key: "2026-02", value: 300, rows: 1 },
    ]);
  });

  it("rows: filtr liczbowy; błędy dla nieznanej kolumny", () => {
    const r = analyzeTable(T, {
      operation: "rows",
      filters: [{ column: "Kwota", op: "gt", value: "900" }],
    }) as { matched: number };
    expect(r.matched).toBe(2);
    expect(analyzeTable(T, { operation: "aggregate", group_by: "Miasto" })).toMatchObject({
      error: "unknown_column",
    });
    expect(analyzeTable(T, { operation: "aggregate", agg: "sum" })).toMatchObject({
      error: "value_column_required_for_sum",
    });
  });
});
