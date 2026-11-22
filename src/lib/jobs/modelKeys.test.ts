import { describe, expect, it } from "vitest";
import { describeKeys, jobModelKeys } from "./modelKeys.server";

describe("jobModelKeys", () => {
  it("prefers keys saved in the app over GitHub secrets", async () => {
    const k = await jobModelKeys(
      "owner",
      { ANTHROPIC_API_KEY: "old-secret", GEMINI_API_KEY: "g-secret" },
      async () => ({ anthropic_api_key: " app-key ", gemini_api_key: null }),
    );
    expect(k.anthropicApiKey).toBe("app-key");
    expect(k.geminiApiKey).toBe("g-secret");
    expect(k.source).toEqual({ anthropic: "ustawienia", gemini: "sekret GitHub" });
    expect(k.readError).toBeNull();
  });

  it("falls back to secrets when the read fails, and says so", async () => {
    const k = await jobModelKeys("owner", { ANTHROPIC_API_KEY: "s" }, async () => {
      throw new Error("brak service role");
    });
    expect(k.anthropicApiKey).toBe("s");
    expect(k.geminiApiKey).toBeNull();
    expect(k.readError).toBe("brak service role");
    expect(describeKeys(k)).toBe(
      "klucze modeli — Claude: sekret GitHub, Gemini: brak (odczyt ustawień nieudany: brak service role)",
    );
  });

  it("no row, no secrets → no keys", async () => {
    const k = await jobModelKeys("owner", {}, async () => null);
    expect(k).toMatchObject({ anthropicApiKey: null, geminiApiKey: null });
  });
});
