import { describe, expect, it } from "vitest";
import { warsawDate, warsawHour, warsawOffsetHours } from "./warsaw";

describe("warsawOffsetHours", () => {
  it("zimą trzyma UTC+1", () => {
    expect(warsawOffsetHours(new Date("2026-01-15T12:00:00Z"))).toBe(1);
    expect(warsawOffsetHours(new Date("2026-12-01T12:00:00Z"))).toBe(1);
  });

  it("latem trzyma UTC+2", () => {
    expect(warsawOffsetHours(new Date("2026-07-15T12:00:00Z"))).toBe(2);
  });

  it("przestawia zegar dokładnie w ostatnią niedzielę marca o 01:00 UTC", () => {
    // 2026: ostatnia niedziela marca to 29.03.
    expect(warsawOffsetHours(new Date("2026-03-29T00:59:59Z"))).toBe(1);
    expect(warsawOffsetHours(new Date("2026-03-29T01:00:00Z"))).toBe(2);
  });

  it("wraca do czasu zimowego w ostatnią niedzielę października", () => {
    // 2026: ostatnia niedziela października to 25.10.
    expect(warsawOffsetHours(new Date("2026-10-25T00:59:59Z"))).toBe(2);
    expect(warsawOffsetHours(new Date("2026-10-25T01:00:00Z"))).toBe(1);
  });

  it("radzi sobie z latami, w których ostatni dzień miesiąca JEST niedzielą", () => {
    // 2027: 28.03 to niedziela i zarazem ostatnia niedziela marca.
    expect(warsawOffsetHours(new Date("2027-03-28T00:59:59Z"))).toBe(1);
    expect(warsawOffsetHours(new Date("2027-03-28T01:00:00Z"))).toBe(2);
    // 2025: 31.10 to piątek, ostatnia niedziela wypada 26.10.
    expect(warsawOffsetHours(new Date("2025-10-26T01:00:00Z"))).toBe(1);
  });
});

describe("warsawHour", () => {
  it("przelicza godzinę UTC na lokalną w obu porach roku", () => {
    expect(warsawHour(new Date("2026-07-15T05:45:00Z"))).toBe(7);
    expect(warsawHour(new Date("2026-01-15T05:45:00Z"))).toBe(6);
  });

  it("nie gubi się przy przejściu przez północ", () => {
    expect(warsawHour(new Date("2026-07-14T22:30:00Z"))).toBe(0);
  });
});

describe("warsawDate", () => {
  it("liczy dobę lokalnie, nie w UTC", () => {
    // 00:30 czasu warszawskiego 15 lipca to jeszcze 14 lipca w UTC.
    expect(warsawDate(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });
});
