// DOJAZD DO PRACY — typy wspólne dla serwera (TomTom), czystych funkcji i
// interfejsu. Osobny plik, bo czyta je i job, i komponent React, a żaden nie
// ma powodu ciągnąć za sobą zależności drugiego.

export type LatLon = { lat: number; lon: number };

/** "to" = z domu do pracy, "back" = z pracy do domu. */
export type CommuteDirection = "to" | "back";

export type CommuteSettings = {
  home: (LatLon & { label: string }) | null;
  work: (LatLon & { label: string }) | null;
  /** Planowany wyjazd z domu, minuty od północy (czas PL). */
  departToMin: number;
  /** Planowany wyjazd z pracy, minuty od północy (czas PL). */
  departBackMin: number;
  /** Na którą trzeba być w pracy; null = nie podano. */
  arriveByMin: number | null;
  alertEnabled: boolean;
  /** Alert, gdy dojazd dłuższy od typowego o co najmniej tyle minut. */
  alertDelayMin: number;
};

export const DEFAULT_COMMUTE_SETTINGS: CommuteSettings = {
  home: null,
  work: null,
  departToMin: 6 * 60,
  departBackMin: 14 * 60 + 50,
  arriveByMin: null,
  alertEnabled: true,
  alertDelayMin: 10,
};

export type StreetRun = { name: string; meters: number };

export type CommuteRoute = {
  /** Punkty trasy do narysowania (uproszczone, najwyżej ~300). */
  points: LatLon[];
  distanceM: number;
  /** Czas przejazdu z ruchem dla zadanej godziny wyjazdu. */
  durationSec: number;
  /** Typowy czas o tej porze (dane historyczne); null, gdy dostawca nie podał. */
  typicalSec: number | null;
  /** Czas bez ruchu. */
  freeFlowSec: number | null;
  departAt: string | null;
  arriveAt: string | null;
  streets: StreetRun[];
  /** id utrudnień, które leżą na tej trasie. */
  incidentIds: string[];
};

export type IncidentKind =
  | "accident"
  | "closure"
  | "lane"
  | "roadworks"
  | "jam"
  | "breakdown"
  | "hazard"
  | "other";

export type CommuteIncident = {
  id: string;
  kind: IncidentKind;
  /** 0 nieznane, 1 małe, 2 średnie, 3 duże, 4 zamknięcie. */
  severity: number;
  road: string | null;
  from: string | null;
  to: string | null;
  description: string | null;
  delaySec: number | null;
  lengthM: number | null;
  startTime: string | null;
  endTime: string | null;
  /** Geometria utrudnienia (uproszczona). */
  positions: LatLon[];
  /** Punkt do postawienia znacznika. */
  at: LatLon;
};

/** Punkt pośredni zapisanej trasy; etykieta to to, co wpisał lub wskazał użytkownik. */
export type ViaPoint = LatLon & { label?: string };

export type SavedRoute = {
  id: string;
  direction: CommuteDirection;
  name: string;
  via: ViaPoint[];
  isDefault: boolean;
};

/** Najwyżej tyle zapisanych tras na kierunek i punktów pośrednich na trasę. */
export const MAX_SAVED_ROUTES = 3;
export const MAX_VIA_POINTS = 3;

/**
 * Jedna z tras do wyboru: zapisana przez użytkownika albo automatyczna
 * (najszybsza / alternatywa). `route` to dokładnie to, co leży na mapie.
 */
export type CommuteOption = {
  /** "saved:<uuid>" albo "auto:<n>". */
  id: string;
  kind: "saved" | "auto";
  name: string;
  isDefault: boolean;
  route: CommuteRoute;
};

export type Detour = {
  /** Opcja, którą proponujemy; po id, bo przez sieć nie przeżyją referencje. */
  optionId: string;
  /** Nazwa zapisanej trasy; null dla automatycznej. */
  name: string | null;
  route: CommuteRoute;
  /** O ile krócej niż trasa główna (ujemne = dłużej, ale omija utrudnienie). */
  savesSec: number;
  /** Ulice, którymi objazd różni się od trasy głównej. */
  via: string[];
  reason: "faster" | "avoids_incident";
};

export type CommuteResult = {
  direction: CommuteDirection;
  origin: LatLon & { label: string };
  destination: LatLon & { label: string };
  /** Trasa domyślna: zapisana oznaczona gwiazdką albo najszybsza automatyczna. */
  main: CommuteRoute;
  /** Pozostałe trasy (do porównania i objazdów). */
  alternatives: CommuteRoute[];
  /** Wszystkie trasy do wyboru, domyślna pierwsza. */
  options: CommuteOption[];
  defaultId: string;
  /** Utrudnienia leżące na trasie głównej albo na jednej z alternatyw. */
  incidents: CommuteIncident[];
  detour: Detour | null;
  /** Czy czas liczono dla „teraz" (żywy ruch), czy dla przyszłej godziny. */
  live: boolean;
  fetchedAt: string;
};
