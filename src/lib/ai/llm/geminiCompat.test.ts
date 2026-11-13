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

describe("adaptGeminiBody — role tur (zgłoszenie 2026-11-13: HTTP 400 „Role 'function' is not supported”)", () => {
  const withTools = {
    contents: [
      { role: "user", parts: [{ text: "Zrób prezentację" }] },
      { role: "model", parts: [{ functionCall: { name: "x", args: {} } }] },
      { role: "function", parts: [{ functionResponse: { name: "x", response: {} } }] },
    ],
  };

  it("3.x/4.x: wynik narzędzia idzie jako tura „user”", () => {
    const out = adaptGeminiBody("gemini-3.8-flash", withTools) as typeof withTools;
    expect(out.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(out.contents[2].parts).toEqual(withTools.contents[2].parts);
  });

  it("także bez generationConfig i w treści jako tekst", () => {
    const out = adaptGeminiBody("gemini-4-hydrogen", JSON.stringify(withTools)) as string;
    expect((JSON.parse(out) as typeof withTools).contents[2].role).toBe("user");
  });

  it("2.x: bez zmian", () => {
    expect(adaptGeminiBody("gemini-2.5-flash", withTools)).toBe(withTools);
  });
});
