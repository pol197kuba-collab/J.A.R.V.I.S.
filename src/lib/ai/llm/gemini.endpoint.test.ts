import { describe, it, expect, afterEach } from "vitest";
import { GEMINI_ENDPOINT_BASE, geminiEndpointBase } from "./gemini";

// Etap 9: test dymny w przeglądarce kieruje wywołania Gemini z serwera na
// lokalną atrapę. Bez zmiennej — zawsze prawdziwe API.
afterEach(() => {
  delete process.env.JARVIS_GEMINI_BASE_URL;
});

describe("geminiEndpointBase", () => {
  it("bez zmiennej: prawdziwe API Google", () => {
    expect(geminiEndpointBase()).toBe(GEMINI_ENDPOINT_BASE);
  });

  it("JARVIS_GEMINI_BASE_URL (test e2e): atrapa, bez końcowego ukośnika", () => {
    process.env.JARVIS_GEMINI_BASE_URL = "http://127.0.0.1:4010/v1beta/models/";
    expect(geminiEndpointBase()).toBe("http://127.0.0.1:4010/v1beta/models");
  });
});
