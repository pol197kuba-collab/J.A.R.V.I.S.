import { describe, expect, it } from "vitest";
import {
  fold,
  freshness,
  nearestNeighbors,
  pickNearest,
  relativeAge,
  searchStars,
  stripAskPrefix,
  ASK_PREFIX,
  type ScreenPoint,
} from "./scene";

describe("pickNearest", () => {
  const pts: ScreenPoint[] = [
    { x: 100, y: 100, visible: true },
    { x: 120, y: 100, visible: true },
    { x: 300, y: 300, visible: false },
  ];

  it("trafia najbliższą gwiazdę w promieniu tolerancji", () => {
    expect(pickNearest(pts, 104, 100, 28)).toBe(0);
    expect(pickNearest(pts, 117, 101, 28)).toBe(1);
  });

  it("poza tolerancją — nic (tapnięcie w pustą przestrzeń zamyka kartę)", () => {
    expect(pickNearest(pts, 200, 200, 28)).toBeNull();
  });

  it("gwiazdy za kamerą / poza kadrem nie są do trafienia", () => {
    expect(pickNearest(pts, 300, 300, 28)).toBeNull();
  });

  it("remis rozstrzyga bliższa kamery", () => {
    expect(pickNearest(pts, 110, 100, 28, [5, 2, 0])).toBe(1);
  });
});

describe("nearestNeighbors", () => {
  it("zwraca k najbliższych bez samej gwiazdy, od najbliższej", () => {
    const stars = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
    ];
    expect(nearestNeighbors(stars, 0, 2)).toEqual([2, 3]);
    expect(nearestNeighbors(stars, 9, 2)).toEqual([]);
  });
});

describe("searchStars", () => {
  const stars = [
    { label: "Ceny paliw w Łodzi", cluster: 0, weight: 3, createdAt: "2026-10-01" },
    { label: "Spacer z Marvelem", cluster: 1, weight: 5, createdAt: "2026-10-02" },
    { label: "Marvel u weterynarza", cluster: 1, weight: 3, createdAt: "2026-10-03" },
    { label: "Notatka bez tematu", cluster: null, weight: 3, createdAt: "2026-10-04" },
  ];
  const clusters = new Map([
    [0, "Paliwa"],
    [1, "Pies Marvel"],
  ]);

  it("bez polskich znaków i wielkości liter", () => {
    expect(fold("Łódź ŻÓŁW")).toBe("lodz zolw");
    expect(searchStars(stars, clusters, "lodzi")).toEqual([0]);
  });

  it("wszystkie słowa muszą pasować; gromada też się liczy", () => {
    expect(searchStars(stars, clusters, "marvel spacer")).toEqual([1]);
    expect(searchStars(stars, clusters, "pies")).toEqual([1, 2]);
  });

  it("przy równym trafieniu wyżej większa waga", () => {
    expect(searchStars(stars, clusters, "marvel")).toEqual([1, 2]);
  });

  it("początek słowa wygrywa z wagą", () => {
    const s = [
      { label: "Superpaliwo", cluster: null, weight: 5, createdAt: "2026-10-01" },
      { label: "Paliwo tanie", cluster: null, weight: 1, createdAt: "2026-10-01" },
    ];
    expect(searchStars(s, new Map(), "paliwo")).toEqual([1, 0]);
  });

  it("puste zapytanie — brak wyników", () => {
    expect(searchStars(stars, clusters, "   ")).toEqual([]);
  });
});

describe("czas", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  it("względny wiek po polsku", () => {
    expect(relativeAge("2026-10-17T11:59:40Z", now)).toBe("przed chwilą");
    expect(relativeAge("2026-10-17T11:55:00Z", now)).toBe("5 min temu");
    expect(relativeAge("2026-10-17T09:00:00Z", now)).toBe("3 godz. temu");
    expect(relativeAge("2026-10-16T09:00:00Z", now)).toBe("wczoraj");
    expect(relativeAge("2026-10-13T09:00:00Z", now)).toBe("4 dni temu");
    expect(relativeAge("nie data", now)).toBe("");
  });

  it("świeżość: dziś ~1, stare nie schodzą poniżej 0,35", () => {
    expect(freshness("2026-10-17T12:00:00Z", now)).toBeCloseTo(1, 5);
    expect(freshness("2020-01-01T00:00:00Z", now)).toBeCloseTo(0.35, 5);
    expect(freshness("x", now)).toBe(0.35);
  });
});

describe("stripAskPrefix", () => {
  it("ślad z pytania z /mozg pokazuje się bez dopisku", () => {
    expect(stripAskPrefix(`${ASK_PREFIX}co wiem o VBA`)).toBe("co wiem o VBA");
    expect(stripAskPrefix("raport sprzedaży")).toBe("raport sprzedaży");
  });
});
