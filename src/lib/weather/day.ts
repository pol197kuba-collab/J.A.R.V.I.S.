// POGODA NA DZIŚ — opis po polsku. Czysta funkcja: ten sam zestaw liczb daje
// zawsze to samo zdanie, bez sieci i bez modelu.
//
// PO CO TO W OGÓLE ISTNIEJE. Briefing ma zaczynać się jak rozmowa, a nie jak
// wydruk: „zapowiada się przyjemny dzień, dwadzieścia cztery stopnie" niesie
// tę samą informację co „24°C / kod 0", tylko nie wymaga tłumaczenia jej
// sobie w głowie o siódmej rano.
//
// ZDANIE POWSTAJE TUTAJ, NIE W MODELU — i to jest decyzja, nie oszczędność.
// Model dostanie ten tekst do przepisania na ładniejszy, ale nie dostanie
// SUROWYCH liczb do zinterpretowania: model proszony o „ciepłe powitanie"
// przy samych danych dopisuje rzeczy, których nikt mu nie powiedział („mam
// nadzieję, że wczorajsze spotkanie poszło dobrze"). Tu każde zdanie ma
// pokrycie w prognozie, a model może je najwyżej przeredagować.

/** Prognoza DOBOWA, nie odczyt bieżący — briefing mówi o dniu, nie o chwili. */
export type DayWeather = {
  /** Najwyższa temperatura dnia, °C. */
  tempMax: number;
  /** Najniższa temperatura dnia, °C — to ona decyduje o szronie na szybie. */
  tempMin: number;
  /** Największa szansa opadu w ciągu dnia, %; null gdy dostawca jej nie podał. */
  precipChancePct: number | null;
  /** Najsilniejszy wiatr dnia, km/h; null gdy brak. */
  windMaxKph: number | null;
  /** Kod WMO, ten sam którego używa Open-Meteo. */
  code: number;
};

export type SkyKind =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing"
  | "snow"
  | "storm";

/**
 * Kody WMO w takim zakresie, w jakim zwraca je Open-Meteo.
 *
 * Etykiety są ZDANIOTWÓRCZE, nie słownikowe: wchodzą w środek zdania
 * („zapowiada się pogodny dzień — 24 stopnie, bezchmurnie"), więc muszą
 * brzmieć jak jego część, a nie jak hasło z tabeli.
 */
const SKY: Record<number, { kind: SkyKind; label: string }> = {
  0: { kind: "clear", label: "bezchmurnie" },
  1: { kind: "clear", label: "niemal bezchmurnie" },
  2: { kind: "cloudy", label: "z przejaśnieniami" },
  3: { kind: "cloudy", label: "pochmurno" },
  45: { kind: "fog", label: "mgliście" },
  48: { kind: "fog", label: "mgliście, z osadzającą się szadzią" },
  51: { kind: "drizzle", label: "słaba mżawka" },
  53: { kind: "drizzle", label: "mżawka" },
  55: { kind: "drizzle", label: "gęsta mżawka" },
  56: { kind: "freezing", label: "marznąca mżawka" },
  57: { kind: "freezing", label: "marznąca mżawka" },
  61: { kind: "rain", label: "słaby deszcz" },
  63: { kind: "rain", label: "deszcz" },
  65: { kind: "rain", label: "mocny deszcz" },
  66: { kind: "freezing", label: "marznący deszcz" },
  67: { kind: "freezing", label: "marznący deszcz" },
  71: { kind: "snow", label: "słaby śnieg" },
  73: { kind: "snow", label: "śnieg" },
  75: { kind: "snow", label: "intensywny śnieg" },
  77: { kind: "snow", label: "śnieg ziarnisty" },
  80: { kind: "rain", label: "przelotne opady" },
  81: { kind: "rain", label: "przelotne opady" },
  82: { kind: "rain", label: "gwałtowne przelotne opady" },
  85: { kind: "snow", label: "przelotny śnieg" },
  86: { kind: "snow", label: "intensywny przelotny śnieg" },
  95: { kind: "storm", label: "burzowo" },
  96: { kind: "storm", label: "burzowo, z gradem" },
  99: { kind: "storm", label: "burzowo, z gradem" },
};

/**
 * Kod nieznany to nie awaria — Open-Meteo może kiedyś dołożyć kod, którego
 * ta tabela nie zna. Wtedy briefing mówi o temperaturze i milczy o niebie,
 * zamiast wypisywać „kod 89", którego nikt nie przeczyta.
 */
export function describeSky(code: number): { kind: SkyKind; label: string } | null {
  return SKY[code] ?? null;
}

/** „24 stopnie", „1 stopień", „minus 5 stopni" — odmiana, nie surowa liczba. */
export function temperatureWords(celsius: number): string {
  const n = Math.round(celsius);
  const abs = Math.abs(n);
  const last = abs % 10;
  const last2 = abs % 100;
  const noun =
    abs === 1
      ? "stopień"
      : last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)
        ? "stopnie"
        : "stopni";
  return n < 0 ? `minus ${abs} ${noun}` : `${abs} ${noun}`;
}

/** Jednym przymiotnikiem: jaki to będzie dzień. */
function mood(weather: DayWeather): string {
  const sky = describeSky(weather.code);
  switch (sky?.kind) {
    case "storm":
      return "burzowy";
    case "snow":
    case "freezing":
      return "zimowy";
    case "rain":
      return "deszczowy";
    case "drizzle":
      return "wilgotny";
    case "fog":
      return "mglisty";
    default:
      break;
  }
  if (weather.tempMax >= 28) return "upalny";
  if (weather.tempMax <= 0) return "mroźny";
  if (sky?.kind === "clear") return weather.tempMax >= 17 ? "naprawdę przyjemny" : "pogodny";
  return "spokojny";
}

/**
 * Rada, nie współczucie.
 *
 * To jest tu najważniejsze rozstrzygnięcie: „przykro mi, że pada" nie pomaga
 * nikomu i po tygodniu brzmi jak automat. „Parasol się przyda" zmienia to,
 * co użytkownik zrobi w ciągu najbliższych dziesięciu minut — i tylko takie
 * zdania mają prawo wejść do powitania.
 *
 * Kolejność warunków jest kolejnością WAŻNOŚCI: ślisko wygrywa z parasolem,
 * bo szron na szybie kosztuje kwadrans, a mokry rękaw nic.
 */
export function dayAdvice(weather: DayWeather): string | null {
  const sky = describeSky(weather.code);

  if (sky?.kind === "freezing" || weather.tempMin <= 0) {
    return "Nad ranem może być ślisko — proszę doliczyć kwadrans na szybę.";
  }
  if (sky?.kind === "storm") {
    return "Lepiej nie planować niczego pod gołym niebem.";
  }
  if (sky?.kind === "snow") {
    return "Sypnie śniegiem, proszę wyjechać z zapasem czasu.";
  }
  if (sky?.kind === "rain" || sky?.kind === "drizzle" || (weather.precipChancePct ?? 0) >= 60) {
    return "Parasol się dziś przyda.";
  }
  if (weather.tempMax >= 28) {
    return "Będzie gorąco — warto mieć przy sobie wodę.";
  }
  if (sky?.kind === "fog") {
    return "Widoczność rano kiepska, proszę uważać na drodze.";
  }
  if (sky?.kind === "clear" && weather.tempMax >= 17) {
    return "Warto to wykorzystać.";
  }
  return null;
}

/**
 * Całe zdanie o pogodzie: nastrój dnia, temperatura, niebo i rada.
 *
 * Poranna różnica temperatur wchodzi do zdania TYLKO wtedy, gdy jest duża.
 * „24 stopnie, nad ranem 22" nie jest informacją; „14 stopni, nad ranem 2"
 * decyduje o tym, czy wyjść w kurtce.
 */
export function weatherSentence(weather: DayWeather): string {
  const sky = describeSky(weather.code);
  const parts = [temperatureWords(weather.tempMax)];
  if (weather.tempMax - weather.tempMin >= 8) {
    parts.push(`nad ranem ${temperatureWords(weather.tempMin)}`);
  }
  if (sky) parts.push(sky.label);
  return `Zapowiada się ${mood(weather)} dzień — ${parts.join(", ")}.`;
}
