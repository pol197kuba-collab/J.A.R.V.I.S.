import { describe, expect, it } from "vitest";
import {
  estimateHistoryTokens,
  trimHistory,
  withoutCurrentInput,
  type HistoryTurn,
} from "./history";

// Etap 3 (A10): historia rozmowy z serwera, przycięta do budżetu tokenów —
// najnowsze wiadomości w całości, starsze odcinane.

const turn = (role: HistoryTurn["role"], chars: number, tag = ""): HistoryTurn => ({
  role,
  text: `${tag}${"x".repeat(Math.max(0, chars - tag.length))}`,
});

describe("trimHistory", () => {
  it("mieści się w budżecie: nic nie odcina, kolejność zachowana", () => {
    const h = [turn("user", 40, "a"), turn("jarvis", 40, "b"), turn("user", 40, "c")];
    expect(trimHistory(h, 1000)).toEqual(h);
  });

  it("za długo: zostają najnowsze w całości, najstarsze odpadają", () => {
    const h = [
      turn("user", 400, "1"),
      turn("jarvis", 400, "2"),
      turn("user", 400, "3"),
      turn("jarvis", 400, "4"),
    ];
    // 400 znaków ≈ 100 tokenów; budżet 250 → mieszczą się 2 najnowsze.
    const got = trimHistory(h, 250);
    expect(got.map((t) => t.text[0])).toEqual(["3", "4"]);
  });

  it("nigdy nie tnie wiadomości w połowie — odcina całe", () => {
    const h = [turn("user", 400, "1"), turn("jarvis", 400, "2")];
    for (const t of trimHistory(h, 150)) expect(t.text.length).toBe(400);
  });

  it("najnowsza wiadomość zostaje, nawet gdy sama przekracza budżet", () => {
    const h = [turn("user", 40, "1"), turn("jarvis", 4000, "2")];
    expect(trimHistory(h, 100).map((t) => t.text[0])).toEqual(["2"]);
  });

  it("puste wiadomości są pomijane", () => {
    expect(trimHistory([{ role: "user", text: "  " }, turn("jarvis", 8, "z")], 100)).toHaveLength(
      1,
    );
  });

  it("szacunek tokenów: ~4 znaki na token", () => {
    expect(estimateHistoryTokens([turn("user", 400)])).toBe(100);
  });
});

describe("withoutCurrentInput", () => {
  it("usuwa ostatnią turę, gdy to ta sama prośba co input", () => {
    const turns: HistoryTurn[] = [
      { role: "jarvis", text: "Dzień dobry." },
      { role: "user", text: "Otwórz jarvisa" },
    ];
    expect(withoutCurrentInput(turns, " Otwórz jarvisa ")).toEqual([
      { role: "jarvis", text: "Dzień dobry." },
    ]);
  });

  it("zostawia historię, gdy ostatnia tura jest inna albo od J.A.R.V.I.S.", () => {
    const turns: HistoryTurn[] = [
      { role: "user", text: "Otwórz jarvisa" },
      { role: "jarvis", text: "Otwarte." },
    ];
    expect(withoutCurrentInput(turns, "Otwórz jarvisa")).toEqual(turns);
    expect(withoutCurrentInput([{ role: "user", text: "Coś innego" }], "Otwórz jarvisa")).toEqual([
      { role: "user", text: "Coś innego" },
    ]);
    expect(withoutCurrentInput([], "x")).toEqual([]);
  });
});
