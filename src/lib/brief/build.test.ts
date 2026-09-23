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
