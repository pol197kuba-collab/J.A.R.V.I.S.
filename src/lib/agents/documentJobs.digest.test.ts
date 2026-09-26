import { describe, expect, it } from "vitest";
import { buildDigest } from "./documentJobs.functions";
import type { DeckSpec, DocSpec } from "./docSpec";

// Skrót treści karmi bramkę jakości, która decyduje, CZY użytkownik w ogóle
// dostanie plik. Wywracał się na każdej prezentacji zbudowanej w tle: brał
// kształt wordowy (`spec.sections`), a prezentacja ma `slides` — więc
// `.entries()` leciało na `undefined` już po wygenerowaniu pliku, tuż przed
// dostarczeniem. Te testy pilnują OBU kształtów.

const deck: DeckSpec = {
  format: "pptx",
  title: "Dodge Charger 3.6 (2015)",
  subtitle: "Prezentacja sprzedażowa",
  filename: "dodge.pptx",
  slides: [
    { layout: "bullets", heading: "Dlaczego ten egzemplarz", bullets: ["Pentastar V6", "RWD"] },
    {
      layout: "metrics",
      heading: "Liczby",
      metrics: [{ value: "292 KM" }, { value: "6,5 s", label: "0-100" }],
    },
    {
      layout: "compare",
      heading: "SXT czy R/T",
      columns: [
        { heading: "SXT", bullets: ["3.6 V6", "taniej"] },
        { heading: "R/T", bullets: ["5.7 HEMI", "drożej"] },
      ],
    },
  ],
};

const doc: DocSpec = {
  format: "docx",
  title: "Raport",
  filename: "raport.docx",
  sections: [{ heading: "Wstęp", content: "Treść wstępu." }],
};

describe("buildDigest", () => {
  it("nie wywraca się na prezentacji", () => {
    // Regresja: `spec.sections` jest undefined dla pptx.
    expect(() => buildDigest(deck)).not.toThrow();
  });

  it("wymienia wszystkie slajdy, nie tylko te z punktami", () => {
    const digest = buildDigest(deck);
    expect(digest).toContain("1. Dlaczego ten egzemplarz");
    expect(digest).toContain("2. Liczby");
    expect(digest).toContain("3. SXT czy R/T");
  });

  it("wyciąga treść z układów, które nie mają content ani bullets", () => {
    // Bez tego sędzia widzi puste pozycje i może odrzucić poprawną
    // prezentację — a odrzucenie kosztuje ponowny przebieg Forge'a.
    const digest = buildDigest(deck);
    expect(digest).toContain("292 KM");
    expect(digest).toContain("6,5 s 0-100");
    expect(digest).toContain("SXT: 3.6 V6, taniej");
    expect(digest).toContain("R/T: 5.7 HEMI, drożej");
  });

  it("nadal obsługuje dokument", () => {
    const digest = buildDigest(doc);
    expect(digest).toContain("Tytuł: Raport");
    expect(digest).toContain("1. Wstęp — Treść wstępu.");
  });
});
