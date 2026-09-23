import { describe, expect, it } from "vitest";
import { dayAdvice, describeSky, temperatureWords, weatherSentence } from "./day";
import type { DayWeather } from "./day";

const day = (patch: Partial<DayWeather>): DayWeather => ({
  tempMax: 20,
  tempMin: 14,
  precipChancePct: 0,
  windMaxKph: 10,
  code: 0,
  ...patch,
});

describe("temperatureWords — odmiana, nie surowa liczba", () => {
  it("odmienia stopnie po polsku", () => {
    expect(temperatureWords(1)).toBe("1 stopień");
    expect(temperatureWords(24)).toBe("24 stopnie");
    expect(temperatureWords(5)).toBe("5 stopni");
    // 12–14 to wyjątek: „dwanaście stopni", nie „dwanaście stopnie".
    expect(temperatureWords(13)).toBe("13 stopni");
    expect(temperatureWords(22)).toBe("22 stopnie");
  });

  it("mówi „minus”, a nie stawia myślnika, którego synteza mowy nie przeczyta", () => {
    expect(temperatureWords(-5)).toBe("minus 5 stopni");
    expect(temperatureWords(0)).toBe("0 stopni");
  });
});

describe("describeSky", () => {
  it("nie wymyśla opisu dla kodu, którego nie zna", () => {
    // Lepiej zdanie bez nieba niż „kod 89" w porannej rubryce.
    expect(describeSky(89)).toBeNull();
  });
});

describe("weatherSentence", () => {
  it("brzmi jak zdanie, nie jak odczyt", () => {
    const text = weatherSentence(day({ tempMax: 24, tempMin: 18, code: 0 }));
    expect(text).toBe("Zapowiada się naprawdę przyjemny dzień — 24 stopnie, bezchmurnie.");
  });

  it("podaje poranek tylko wtedy, gdy różnica jest znacząca", () => {
    expect(weatherSentence(day({ tempMax: 24, tempMin: 18 }))).not.toContain("nad ranem");
    expect(weatherSentence(day({ tempMax: 14, tempMin: 2, code: 3 }))).toContain(
      "nad ranem 2 stopnie",
    );
  });

  it("nie zgaduje nieba przy nieznanym kodzie", () => {
    const text = weatherSentence(day({ code: 89 }));
    expect(text).toContain("20 stopni");
    expect(text).not.toContain("kod");
  });
});

describe("dayAdvice — rada, nie współczucie", () => {
  it("stawia przymrozek ponad parasol", () => {
    // Szron kosztuje kwadrans, mokry rękaw nie kosztuje nic.
    const frosty = day({ tempMax: 4, tempMin: -2, code: 63, precipChancePct: 90 });
    expect(dayAdvice(frosty)).toContain("szybę");
  });

  it("radzi parasol, gdy sam kod nie mówi o deszczu, ale szansa jest wysoka", () => {
    expect(dayAdvice(day({ code: 3, precipChancePct: 75 }))).toBe("Parasol się dziś przyda.");
  });

  it("milczy, gdy nie ma czego doradzić", () => {
    // Codzienne zdanie wypełniacz nauczyłoby przewijać całe powitanie.
    expect(dayAdvice(day({ tempMax: 12, tempMin: 8, code: 2, precipChancePct: 10 }))).toBeNull();
  });

  it("zachęca, gdy dzień jest po prostu ładny", () => {
    expect(dayAdvice(day({ tempMax: 24, tempMin: 16, code: 0 }))).toBe("Warto to wykorzystać.");
  });
});
