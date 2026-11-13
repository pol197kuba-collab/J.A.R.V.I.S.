import { describe, expect, it } from "vitest";
import { adaptGeminiBody, isModernGemini } from "./geminiCompat";

const body = {
  contents: [{ role: "user", parts: [{ text: "x" }] }],
  generationConfig: {
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 900,
    thinkingConfig: { thinkingBudget: 0 },
  },
};

describe("isModernGemini", () => {
  it("3.x i 4.x tak, 2.x i nie-Gemini nie", () => {
    expect(isModernGemini("gemini-3.8-flash")).toBe(true);
    expect(isModernGemini("gemini-3.5-flash-lite")).toBe(true);
    expect(isModernGemini("gemini-4-hydrogen")).toBe(true);
    expect(isModernGemini("gemini-2.5-flash")).toBe(false);
    expect(isModernGemini("claude-opus-5")).toBe(false);
  });
});

describe("adaptGeminiBody", () => {
  it("2.x: zapytanie bez zmian", () => {
    expect(adaptGeminiBody("gemini-2.5-flash", body)).toBe(body);
  });

  it("3.x: bez parametrów próbkowania, budżet 0 → thinkingLevel low", () => {
    expect(adaptGeminiBody("gemini-3.8-flash", body)).toEqual({
      contents: body.contents,
      generationConfig: { maxOutputTokens: 900, thinkingConfig: { thinkingLevel: "low" } },
    });
  });

  it("niezerowy budżet znika (domyślny poziom modelu); treść jako tekst zostaje tekstem", () => {
    const s = JSON.stringify({
      generationConfig: { temperature: 1, thinkingConfig: { thinkingBudget: 512 } },
    });
    const out = adaptGeminiBody("gemini-4-hydrogen", s);
    expect(typeof out).toBe("string");
    expect(JSON.parse(out as string)).toEqual({ generationConfig: {} });
  });

  it("bez generationConfig — bez zmian", () => {
    const b = { contents: [] };
    expect(adaptGeminiBody("gemini-3.8-flash", b)).toBe(b);
  });
});
