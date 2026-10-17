import { describe, expect, it } from "vitest";
import { documentMarkdown, fridgeNote } from "./route";

describe("scan routing text", () => {
  it("a document becomes Markdown with its summary and full text", () => {
    const md = documentMarkdown(
      { title: "Umowa najmu", docType: "umowa", summary: "Najem na rok.", text: "§1\n\nTreść" },
      "2026-10-17",
    );
    expect(md).toBe(
      "# Umowa najmu\n\n_umowa · zeskanowano 2026-10-17 (Vision)_\n\n## Streszczenie\n\nNajem na rok.\n\n## Tekst\n\n§1\n\nTreść",
    );
    expect(documentMarkdown({ title: "X", docType: "pismo", summary: "", text: "" }, "d")).toBe(
      "# X\n\n_pismo · zeskanowano d (Vision)_",
    );
  });

  it("the fridge becomes a note titled by the recipe", () => {
    expect(
      fridgeNote(
        { products: ["jajka", "mleko"], recipe: { title: "Omlet", steps: ["Roztrzep", "Smaż"] } },
        "2026-10-17",
      ),
    ).toEqual({
      title: "Przepis: Omlet",
      body: "W lodówce (2026-10-17):\n- jajka\n- mleko\n\nOmlet:\n1. Roztrzep\n2. Smaż",
    });
    expect(fridgeNote({ products: ["ser"], recipe: null }, "2026-10-17").title).toBe(
      "Lodówka 2026-10-17",
    );
  });
});
