import { describe, expect, it } from "vitest";
import { isOnTopic } from "./imageRelevance";

// Przypadki wzięte ŻYWCEM z prezentacji o GTA VI (26 września), w której
// każde zdjęcie było pobrane poprawnie i żadne nie było na temat.

describe("isOnTopic — odrzuca to, co odpaliło się na GTA VI", () => {
  it("odrzuca artykuł o innym studiu", () => {
    // Wikipedia na „Rockstar Games logo office" zwróciła „Rockstar Leeds".
    expect(isOnTopic("Rockstar Games logo office", "Rockstar Leeds")).toBe(false);
  });

  it("odrzuca plakat filmu na slajdzie o bohaterach gry", () => {
    expect(isOnTopic("Lucia and Jason GTA VI protagonists", "Scarface 1932 film poster")).toBe(
      false,
    );
  });

  it("odrzuca parking z lat 50. na slajdzie o Vice City", () => {
    expect(isOnTopic("Vice City Leonida game world", "Thriftimart parking lot 1956")).toBe(false);
  });

  it("odrzuca rafę koralową jako ilustrację świata gry", () => {
    expect(isOnTopic("Grand Theft Auto VI map", "aerial view of coral reef")).toBe(false);
  });
});

describe("isOnTopic — przepuszcza trafienia poprawne", () => {
  it("przepuszcza tytuł z nadmiarowymi słowami", () => {
    // Tytuły z archiwów prawie zawsze mają ogon; to nie powód do odrzucenia.
    expect(
      isOnTopic("2015 Dodge Charger", "2015 Dodge Charger SRT Hellcat: Iron Lion from Zion"),
    ).toBe(true);
  });

  it("przepuszcza dokładne trafienie", () => {
    expect(isOnTopic("Grand Theft Auto VI", "Grand Theft Auto VI")).toBe(true);
  });

  it("znosi ogonki po obu stronach", () => {
    expect(isOnTopic("zamek w Malborku", "Zamek krzyżacki w Malborku")).toBe(true);
    expect(isOnTopic("Zamek Malbork", "Malbork Castle")).toBe(true);
  });

  it("znosi odmianę i liczbę mnogą", () => {
    expect(isOnTopic("Samsung Galaxy S26 Ultra smartphone", "Samsung Galaxy S26 Ultra")).toBe(true);
  });
});

describe("isOnTopic — brak opisu", () => {
  it("odrzuca kandydata, o którym nic nie wiadomo", () => {
    // Warstwa, która nie mówi co znalazła, nie daje się sprawdzić — a
    // niesprawdzone zdjęcie to dokładnie ten przypadek, o który chodzi.
    expect(isOnTopic("cokolwiek konkretnego", null)).toBe(false);
    expect(isOnTopic("cokolwiek konkretnego", "")).toBe(false);
  });

  it("odrzuca, gdy zapytanie jest samymi spójnikami", () => {
    expect(isOnTopic("w i na", "cokolwiek")).toBe(false);
  });
});
