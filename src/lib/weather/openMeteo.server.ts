// Prognoza dobowa z Open-Meteo. Bez klucza, bez konta, bez limitu, który
// dałoby się tu przekroczyć jednym odpytaniem na dobę.
//
// DOBOWA, NIE BIEŻĄCA. Pulpit pokazuje odczyt „teraz" (WeatherTelemetry) i
// tak ma być — patrzy się na niego w ciągu dnia. Briefing czyta się raz,
// rano, i odpowiada na inne pytanie: „jak ubrać się na DZIŚ". Odczyt z
// siódmej rano odpowiedziałby na nie myląco — o siódmej prawie zawsze jest
// chłodno i prawie nigdy nie pada tyle, co po południu.
import type { DayWeather } from "./day";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8_000;

/**
 * Prognoza na dziś dla podanego punktu.
 *
 * RZUCA WYJĄTKIEM Z POWODEM, zamiast zwracać `null`. Wcześniej każde
 * niepowodzenie — brak sieci, odmowa dostawcy, odpowiedź bez temperatury —
 * kończyło się tym samym cichym `null`, nieodróżnialnym od „użytkownik nie
 * podał lokalizacji". W efekcie rubryka bez pogody nie mówiła NIC o tym,
 * czego jej brakuje, a jedynym sposobem sprawdzenia było zgadywanie z
 * drugiej strony ekranu. Powód łapie `loadWeather` i zapisuje go do
 * `system_events`, skąd trafia do sekcji „Usterki" następnego briefingu.
 *
 * Strefa czasowa idzie do dostawcy JAWNIE: bez niej Open-Meteo dzieli dobę
 * po UTC i pierwszy dzień prognozy przestaje być tym „dziś", o którym mówi
 * reszta rubryki (ona liczy dobę warszawską).
 */
export async function fetchDayWeather(lat: number, lon: number): Promise<DayWeather> {
  const url =
    `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min," +
    "precipitation_probability_max,wind_speed_10m_max" +
    "&timezone=Europe%2FWarsaw&forecast_days=1";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (cause) {
      // Przerwanie po czasie wygląda w logu jak zwykły „AbortError" i nie
      // mówi, ile czekaliśmy — a to jedyna liczba, która się tu przydaje.
      throw new Error(
        ctrl.signal.aborted
          ? `open-meteo: brak odpowiedzi w ${TIMEOUT_MS / 1000} s`
          : `open-meteo: połączenie nieudane (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    if (!res.ok) throw new Error(`open-meteo: odpowiedź HTTP ${res.status}`);
    const data = (await res.json()) as {
      daily?: {
        weather_code?: Array<number | null>;
        temperature_2m_max?: Array<number | null>;
        temperature_2m_min?: Array<number | null>;
        precipitation_probability_max?: Array<number | null>;
        wind_speed_10m_max?: Array<number | null>;
      };
    };
    const daily = data.daily;
    const tempMax = daily?.temperature_2m_max?.[0];
    const tempMin = daily?.temperature_2m_min?.[0];
    const code = daily?.weather_code?.[0];
    // Temperatura i kod to minimum, z którego da się ułożyć zdanie. Bez nich
    // zostałaby sama szansa opadu, a „szansa opadu 20%" nie jest powitaniem.
    if (typeof tempMax !== "number" || typeof tempMin !== "number" || typeof code !== "number") {
      throw new Error("open-meteo: odpowiedź bez temperatury albo kodu pogody");
    }
    const precip = daily?.precipitation_probability_max?.[0];
    const wind = daily?.wind_speed_10m_max?.[0];
    return {
      tempMax,
      tempMin,
      code,
      precipChancePct: typeof precip === "number" ? precip : null,
      windMaxKph: typeof wind === "number" ? wind : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
