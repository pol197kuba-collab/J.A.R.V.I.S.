import { describe, expect, it } from "vitest";
import { isUsableGreeting, parseParts } from "./build.server";

// Model zwraca POWITANIE i BRIEFING w jednej odpowiedzi, bo mają różne
// reguły: jedno wolno napisać swobodnie, drugiego nie wolno skrócić.
// Wszystko, co może pójść nie tak, idzie nie tak właśnie na tym szwie.

describe("parseParts", () => {
  it("rozdziela odpowiedź po znacznikach", () => {
    const got = parseParts("POWITANIE: Witam, Panie Sławiński.\nBRIEFING: Rynki spokojne.");
    expect(got).toEqual({ greeting: "Witam, Panie Sławiński.", body: "Rynki spokojne." });
  });

  it("odrzuca odpowiedź bez znacznika — wtedy wraca wersja z liczb", () => {
    // Model, który zignorował układ, mógł zignorować też resztę zasad.
    expect(parseParts("Witam, Panie Sławiński. Rynki spokojne.")).toBeNull();
    expect(parseParts("POWITANIE: Witam.")).toBeNull();
  });

  it("odrzuca odwróconą kolejność i puste kawałki", () => {
    expect(parseParts("BRIEFING: Rynki.\nPOWITANIE: Witam.")).toBeNull();
    expect(parseParts("POWITANIE:\nBRIEFING: Rynki.")).toBeNull();
  });
});

describe("isUsableGreeting", () => {
  it("przyjmuje krótsze powitanie niż oryginał", () => {
    // Inaczej niż treść, powitanie WOLNO skrócić — zwięzłe bywa lepsze.
    expect(isUsableGreeting("Witam, Panie Sławiński. Piękny dzień.")).toBe(true);
  });

  it("odrzuca drugi briefing w miejscu powitania", () => {
    expect(isUsableGreeting("Witam. ".repeat(60))).toBe(false);
  });

  it("odrzuca listę i markdown", () => {
    expect(isUsableGreeting("- Witam, Panie Sławiński.")).toBe(false);
  });
});

// Etap 2: przepisanie briefingu przez model zostawia wiersz w księdze.
describe("polishBrief — księga llm_usage", () => {
  it("Gemini: klucz w nagłówku, wiersz z modułem brief", async () => {
    const { vi } = await import("vitest");
    const { makeDb } = await import("@/lib/agents/runtime.testkit");
    const { polishBrief } = await import("./build.server");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "POWITANIE: Dzień dobry, Panie Sławiński.\nBRIEFING: Rynki spokojne, paliwo bez zmian.",
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 },
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = makeDb(() => undefined);

    const got = await polishBrief(
      { greeting: "Dzień dobry.", body: "Rynki spokojne, paliwo bez zmian." },
      { anthropicApiKey: null, geminiApiKey: "tajny" },
      { db, ownerId: "u1", module: "brief", purpose: "polish" },
    );
    vi.unstubAllGlobals();

    expect(got.generatedBy).toBe("model:gemini-2.5-flash");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tajny");
    const row = calls.find((c) => c.table === "llm_usage")?.ops[0].args[0];
    expect(row).toMatchObject({ module: "brief", purpose: "polish", tokens_input: 200 });
  });
});

// W8 (etap 6b): briefing 13.11 wyszedł „z samych liczb”, choć oba klucze
// modeli były ustawione — przepisanie padło po cichu. Powód ma wracać do
// wołającego, żeby job mógł go pokazać.
describe("polishBrief — powód powrotu do samych liczb", () => {
  it("pusta odpowiedź modelu → generatedBy facts i powód z nazwą modelu", async () => {
    const { vi } = await import("vitest");
    const { polishBrief } = await import("./build.server");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 0 },
        }),
        text: async () => "",
      }),
    );
    const got = await polishBrief(
      { greeting: "Dzień dobry.", body: "Rynki spokojne, paliwo bez zmian." },
      { anthropicApiKey: null, geminiApiKey: "k" },
    );
    vi.unstubAllGlobals();
    expect(got.generatedBy).toBe("facts");
    expect(got.fallbackReasons).toEqual(["gemini-2.5-flash: pusta odpowiedź"]);
  });
});
