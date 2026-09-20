import { describe, expect, it } from "vitest";
import { COMMAND_REGISTRY } from "./registry";

// VoiceCommandContext wybiera PIERWSZE dopasowanie z tablicy
// (`COMMANDS.find((c) => c.re.test(transcript))`), więc kolejność wpisów
// jest zachowaniem, nie kosmetyką. Dwa wzorce paliwowe zachodzą na siebie
// przy frazie "open fuel prices" i to tutaj pilnujemy, która wygrywa.
function firstMatch(transcript: string): string | undefined {
  return COMMAND_REGISTRY.find((c) => c.pattern.test(transcript))?.id;
}

describe("COMMAND_REGISTRY", () => {
  it("nie ma zduplikowanych id", () => {
    const ids = COMMAND_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("każda komenda ma wzorzec, etykietę i potwierdzenie", () => {
    for (const command of COMMAND_REGISTRY) {
      expect(command.pattern, command.id).toBeInstanceOf(RegExp);
      expect(command.label.trim().length, command.id).toBeGreaterThan(0);
      expect(command.confirmation.trim().length, command.id).toBeGreaterThan(0);
    }
  });

  describe("rozdział komend paliwowych", () => {
    it("frazy o cenach prowadzą do modułu cennika", () => {
      expect(firstMatch("jarvis ceny paliw")).toBe("open_fuel_prices");
      expect(firstMatch("show fuel prices")).toBe("open_fuel_prices");
      expect(firstMatch("jarvis pokaż cennik hurtowy")).toBe("open_fuel_prices");
      expect(firstMatch("ceny orlenu")).toBe("open_fuel_prices");
      expect(firstMatch("wholesale fuel")).toBe("open_fuel_prices");
    });

    it("dwuznaczne 'open fuel prices' trafia do cennika, nie do sub-systemu", () => {
      expect(firstMatch("open fuel prices")).toBe("open_fuel_prices");
    });

    it("frazy o monitorze nadal prowadzą do sub-systemu", () => {
      expect(firstMatch("jarvis open fuel")).toBe("open_fuel");
      expect(firstMatch("jarvis otwórz monitor paliwa")).toBe("open_fuel");
      expect(firstMatch("launch monitor")).toBe("open_fuel");
    });
  });
});
