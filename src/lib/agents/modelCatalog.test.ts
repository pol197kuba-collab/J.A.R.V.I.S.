import { describe, expect, it } from "vitest";
import { mergeModelLists, parseAnthropicModelList, parseGeminiModelList } from "./modelCatalog";
import { GEMINI_MODELS } from "./models";

describe("parseGeminiModelList", () => {
  const raw = {
    models: [
      {
        name: "models/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        description: "Fast and versatile",
        inputTokenLimit: 1048576,
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
      {
        name: "models/gemini-embedding-001",
        displayName: "Embedding",
        supportedGenerationMethods: ["embedContent"],
      },
      {
        name: "models/gemini-2.5-flash-image",
        displayName: "Image gen",
        supportedGenerationMethods: ["generateContent"],
      },
      {
        name: "models/gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        supportedGenerationMethods: ["generateContent"],
      },
    ],
  };

  it("strips the models/ prefix the runtime does not use", () => {
    expect(parseGeminiModelList(raw).map((m) => m.id)).toContain("gemini-2.5-flash");
  });

  it("drops models that cannot serve a conversational turn", () => {
    const ids = parseGeminiModelList(raw).map((m) => m.id);
    // Bez generateContent tura rozmowy skończyłaby się 400 dopiero przy
    // pierwszej wiadomości — lepiej nie pokazywać ich w dropdownie wcale.
    expect(ids).not.toContain("gemini-embedding-001");
    // Generator obrazu deklaruje generateContent, ale nie jest rozmówcą.
    expect(ids).not.toContain("gemini-2.5-flash-image");
  });

  it("puts the context window in the hint when the API reports one", () => {
    const flash = parseGeminiModelList(raw).find((m) => m.id === "gemini-2.5-flash");
    expect(flash?.hint).toBe("Kontekst 1049k");
  });

  it("falls back to the raw id when displayName is missing", () => {
    const parsed = parseGeminiModelList({
      models: [{ name: "models/x-1", supportedGenerationMethods: ["generateContent"] }],
    });
    expect(parsed[0].label).toBe("x-1");
  });

  it("returns an empty list instead of throwing on a malformed payload", () => {
    expect(parseGeminiModelList(null)).toEqual([]);
    expect(parseGeminiModelList({ error: { message: "API key not valid" } })).toEqual([]);
    expect(parseGeminiModelList({ models: "nope" })).toEqual([]);
  });

  it("sorts stably so the dropdown does not reshuffle between refreshes", () => {
    const ids = parseGeminiModelList(raw).map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("parseAnthropicModelList", () => {
  const raw = {
    data: [
      { id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-04-01T00:00:00Z" },
      { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
    ],
  };

  it("prefixes ids so the runtime routes them to the Claude adapter", () => {
    expect(parseAnthropicModelList(raw).map((m) => m.id)).toEqual([
      "anthropic:claude-opus-5",
      "anthropic:claude-sonnet-5",
    ]);
  });

  it("keeps the API's newest-first order", () => {
    expect(parseAnthropicModelList(raw)[0].label).toBe("Claude Opus 5");
  });

  it("survives an error payload", () => {
    expect(parseAnthropicModelList({ type: "error", error: {} })).toEqual([]);
  });
});

describe("mergeModelLists", () => {
  it("prefers the live entry and keeps a fallback the API did not return", () => {
    const live = [{ id: "gemini-2.5-flash", label: "Z API", provider: "gemini" as const }];
    const merged = mergeModelLists(live, GEMINI_MODELS);
    expect(merged.find((m) => m.id === "gemini-2.5-flash")?.label).toBe("Z API");
    // Model wybrany wcześniej ręcznie nie może zniknąć z listy tylko
    // dlatego, że API go nie wymieniło.
    expect(merged.some((m) => m.id === "gemini-2.5-pro")).toBe(true);
  });

  it("returns just the fallback when nothing came from the API", () => {
    expect(mergeModelLists([], GEMINI_MODELS)).toEqual(GEMINI_MODELS);
  });
});
