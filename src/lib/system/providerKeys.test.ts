import { describe, expect, it } from "vitest";
import { classifyKeyFailure, findKeyFailures } from "./providerKeys";

describe("classifyKeyFailure", () => {
  it("rozpoznaje zły klucz Anthropic", () => {
    expect(
      classifyKeyFailure(
        "anthropic",
        401,
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      ),
    ).toBe("invalid_key");
  });

  it("rozpoznaje brak środków mimo statusu 400", () => {
    expect(
      classifyKeyFailure("anthropic", 400, "Your credit balance is too low to access the API"),
    ).toBe("no_credit");
  });

  it("rozpoznaje wyłączone API Gemini", () => {
    expect(
      classifyKeyFailure(
        "gemini",
        403,
        "Gemini API has not been used in project 1099387078183 before or it is disabled.",
      ),
    ).toBe("api_disabled");
  });

  it("rozpoznaje zły klucz Gemini zwracany jako 400", () => {
    expect(
      classifyKeyFailure("gemini", 400, "API key not valid. Please pass a valid API key."),
    ).toBe("invalid_key");
  });

  it("nie alarmuje przy limicie i błędach serwera", () => {
    expect(classifyKeyFailure("gemini", 429, "RESOURCE_EXHAUSTED")).toBeNull();
    expect(classifyKeyFailure("anthropic", 529, "overloaded_error")).toBeNull();
    expect(classifyKeyFailure("groq", null, "network")).toBeNull();
  });
});

describe("findKeyFailures", () => {
  it("rozdziela wpis z dwoma dostawcami", () => {
    const msg =
      'Typer: brak prognozy modelu — Claude: Anthropic HTTP 400: {"message":"Your credit balance is too low"} · Gemini HTTP 403: {"message":"Gemini API has not been used in project 1 before or it is disabled"}';
    expect(findKeyFailures(msg)).toEqual([
      { provider: "anthropic", reason: "no_credit" },
      { provider: "gemini", reason: "api_disabled" },
    ]);
  });

  it("czyta wpis o przejściu z Claude na Gemini", () => {
    const msg =
      'Claude (claude-opus-5) nie odpowiedział — ta tura idzie na gemini-2.5-flash: Anthropic HTTP 401: {"error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    expect(findKeyFailures(msg)).toEqual([{ provider: "anthropic", reason: "invalid_key" }]);
  });

  it("pomija zwykłe wpisy", () => {
    expect(findKeyFailures("pusta tura Gemini — ponawiam ją raz bez myślenia")).toEqual([]);
    expect(findKeyFailures("Gemini HTTP 429: quota")).toEqual([]);
  });
});
