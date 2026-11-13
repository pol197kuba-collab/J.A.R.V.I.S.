import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { groundingModel } from "./web.server";

describe("web_search: model wyszukiwania", () => {
  it("agent na Gemini szuka swoim modelem", () => {
    expect(groundingModel("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("agent na Claude albo Groq szuka domyślnym Gemini (wcześniej HTTP 404)", () => {
    expect(groundingModel("claude-opus-5")).toBe(DEFAULT_GEMINI_MODEL);
    expect(groundingModel("openai/gpt-oss-120b")).toBe(DEFAULT_GEMINI_MODEL);
    expect(groundingModel("")).toBe(DEFAULT_GEMINI_MODEL);
  });
});
