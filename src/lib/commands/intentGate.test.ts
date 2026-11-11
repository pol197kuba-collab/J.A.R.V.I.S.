import { describe, expect, it } from "vitest";
import { looksLikeDocumentRequest, looksLikeUiCommand } from "./intentGate";

// Etap 3 (A9): klasyfikator UI kosztuje drugie wywołanie modelu po KAŻDEJ
// turze bez narzędzi. Uruchamiamy go tylko wtedy, gdy wypowiedź w ogóle
// wygląda na polecenie dla interfejsu. Przypadki z komentarzy w
// runtime.server.ts: luźne polecenia nawigacji mają nadal działać, pytania
// merytoryczne nie mogą odpalać klasyfikatora.

describe("looksLikeUiCommand", () => {
  it("dokładne komendy z rejestru", () => {
    for (const s of [
      "otwórz pulpit",
      "pokaż dashboard",
      "Jarvis, otwórz panel JARVIS",
      "open dashboard",
    ]) {
      expect(looksLikeUiCommand(s), s).toBe(true);
    }
  });

  it("luźne polecenia nawigacji (dlatego klasyfikator w ogóle istnieje)", () => {
    for (const s of [
      "przełącz mnie na rynki",
      "pokaż mi zadania",
      "zamknij to",
      "wróć do głównego ekranu",
      "przejdź do ustawień",
      "pokaż zadania",
      "go to settings",
    ]) {
      expect(looksLikeUiCommand(s), s).toBe(true);
    }
  });

  it("pytania i prośby o informację nie odpalają klasyfikatora", () => {
    for (const s of [
      "co się ostatnio wywaliło?",
      "jak idzie zadanie?",
      "niech SHIELD sprawdzi błędy",
      "Jak się masz?",
      "Cześć",
      "Dzień dobry, Jarvis",
      "jaka jest dziś pogoda w Warszawie",
      "streść mi dokument o fakturach",
      "co jest w dokumencie X",
    ]) {
      expect(looksLikeUiCommand(s), s).toBe(false);
    }
  });

  it("długie wypowiedzi to nie komendy, nawet z czasownikiem nawigacji", () => {
    expect(
      looksLikeUiCommand(
        "pokaż mi proszę jak wyglądały wyniki sprzedaży w trzecim kwartale w porównaniu z drugim i dlaczego spadły",
      ),
    ).toBe(false);
  });
});

describe("looksLikeDocumentRequest", () => {
  it("prośby o plik idą do klasyfikatora (queue_document_job)", () => {
    for (const s of [
      "zrób mi prezentację o Warszawie",
      "przygotuj raport o rynku paliw",
      "make a pptx about AI",
    ]) {
      expect(looksLikeDocumentRequest(s), s).toBe(true);
    }
  });

  it("pytania o istniejące dokumenty to nie prośba o nowy plik", () => {
    expect(looksLikeDocumentRequest("co jest w dokumencie X?")).toBe(false);
    expect(looksLikeDocumentRequest("Cześć")).toBe(false);
  });
});
