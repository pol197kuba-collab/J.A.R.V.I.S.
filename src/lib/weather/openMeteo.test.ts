import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDayWeather } from "./openMeteo.server";

// Ta funkcja istnieje po to, żeby NIE MILCZEĆ. Wcześniej każde niepowodzenie
// kończyło się tym samym `null`, nieodróżnialnym od „użytkownik nie podał
// lokalizacji" — i właśnie to kosztowało jedną rundę zgadywania, czemu
// briefing nie mówi o pogodzie. Testy pilnują powodów, nie tylko ścieżki
// szczęśliwej.

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);

afterEach(() => vi.unstubAllGlobals());

describe("fetchDayWeather — odczyt prognozy", () => {
  it("składa prognozę z pierwszego dnia", async () => {
    vi.stubGlobal(
      "fetch",
      ok({
        daily: {
          time: ["2026-09-23"],
          weather_code: [51],
          temperature_2m_max: [15.4],
          temperature_2m_min: [10.8],
          precipitation_probability_max: [63],
          wind_speed_10m_max: [18.7],
        },
      }),
    );
    await expect(fetchDayWeather(51.6, 18.94)).resolves.toEqual({
      tempMax: 15.4,
      tempMin: 10.8,
      code: 51,
      precipChancePct: 63,
      windMaxKph: 18.7,
    });
  });

  it("pyta o dobę warszawską, nie o UTC", async () => {
    // Bez tego pierwszy dzień prognozy przestaje być tym „dziś", o którym
    // mówi reszta rubryki — ona liczy dobę lokalnie.
    const spy = ok({
      daily: { weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [10] },
    });
    vi.stubGlobal("fetch", spy);
    await fetchDayWeather(51.6, 18.94);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("timezone=Europe%2FWarsaw");
    expect(url).toContain("forecast_days=1");
  });

  it("przyjmuje prognozę bez opadu i wiatru — to pola opcjonalne", async () => {
    vi.stubGlobal(
      "fetch",
      ok({ daily: { weather_code: [0], temperature_2m_max: [20], temperature_2m_min: [10] } }),
    );
    const got = await fetchDayWeather(51.6, 18.94);
    expect(got.precipChancePct).toBeNull();
    expect(got.windMaxKph).toBeNull();
  });
});

describe("fetchDayWeather — powód niepowodzenia", () => {
  it("podaje kod HTTP, a nie samo „nie wyszło”", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    await expect(fetchDayWeather(51.6, 18.94)).rejects.toThrow("HTTP 429");
  });

  it("melduje odpowiedź bez temperatury zamiast udawać, że jej nie było", async () => {
    // Dostawca odpowiedział, tylko bez tego, co jest potrzebne do zdania.
    vi.stubGlobal("fetch", ok({ daily: { precipitation_probability_max: [10] } }));
    await expect(fetchDayWeather(51.6, 18.94)).rejects.toThrow("bez temperatury");
  });

  it("przekłada zerwane połączenie na czytelny powód", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));
    await expect(fetchDayWeather(51.6, 18.94)).rejects.toThrow("połączenie nieudane");
  });
});
