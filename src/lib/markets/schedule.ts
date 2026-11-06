// Kiedy biegnie Market Grid — czysta decyzja, bez bazy i bez zegara systemowego.
//
// DWIE SESJE (od 6.11.2026). Każdy instrument ma JEDNĄ decyzję dziennie (to
// trzyma rozliczanie skuteczności), ale o porze, która pasuje do jego rynku:
// - rano (MORNING_HOUR:MORNING_MINUTE, dni robocze) — akcje, ETF-y, indeksy:
//   decyzja przed otwarciem sesji, z nocnymi newsami, a nie 13 godzin wcześniej;
// - wieczorem (MARKET_HOUR) — krypto, surowce, waluty (handel prawie całą dobę).
//
// PROBLEM. Cron GitHuba „20:00” w praktyce ruszał koło 22:00–00:30, więc
// od 20.10.2026 job uruchamia baza (pg_cron + workflow_dispatch, migracja
// 20261020120000_market_grid_dispatch.sql) o MARKET_HOUR czasu warszawskiego.
// Cron GitHuba zostaje jako zapas — ale gdy przyjdzie spóźniony po przebiegu
// z bazy, nie może zrobić drugiego (to drugie wywołanie modelu i podwójne
// newsy za te same pieniądze).
//
// DLACZEGO OKNO 12 GODZIN, A NIE „DZISIEJSZA DATA”. Spóźniony cron dnia D
// potrafi przyjść po północy, czyli już w dniu D+1 — porównanie dat puściłoby
// go jako „pierwszy przebieg dnia”. 12 godzin łapie go niezależnie od północy,
// a jednocześnie jest krótsze niż doba, więc następny wieczorny przebieg nigdy
// nie zostanie wstrzymany przez wczorajszy.

import type { AssetClass } from "./assets";

/** Godzina warszawska, o której baza uruchamia Market Grid (w SQL ta sama stała). */
export const MARKET_HOUR = 20;
/** Poranny przebieg (dni robocze) — w SQL te same stałe. */
export const MORNING_HOUR = 8;
export const MORNING_MINUTE = 30;
/** Granica sesji: przebieg przed nią (od 4:00) jest poranny, od niej wieczorny. */
export const SESSION_SPLIT_HOUR = 14;

export type MarketSession = "morning" | "evening";

/** Na czym decyduje każda sesja. Razem: wszystkie klasy, każda dokładnie raz. */
export const SESSION_CLASSES: Readonly<Record<MarketSession, readonly AssetClass[]>> = {
  morning: ["equity", "etf", "index"],
  evening: ["crypto", "commodity", "fx"],
};

export const SESSION_LABEL: Readonly<Record<MarketSession, string>> = {
  morning: `${MORNING_HOUR}:${String(MORNING_MINUTE).padStart(2, "0")} — akcje, ETF-y, indeksy`,
  evening: `${MARKET_HOUR}:00 — krypto, surowce, waluty`,
};

/** Godzina (0–23) w Warszawie. */
export function warsawHour(at: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return Number(h);
}

/** Do której sesji należy chwila (start albo koniec przebiegu). */
export function sessionAt(at: Date): MarketSession {
  const h = warsawHour(at);
  return h >= 4 && h < SESSION_SPLIT_HOUR ? "morning" : "evening";
}

/** Najnowszy zakończony przebieg danej sesji (lista w dowolnej kolejności). */
export function lastRunOfSession(
  finishedAts: readonly string[],
  session: MarketSession,
): string | null {
  let best: string | null = null;
  for (const at of finishedAts) {
    if (sessionAt(new Date(at)) !== session) continue;
    if (!best || Date.parse(at) > Date.parse(best)) best = at;
  }
  return best;
}

/** Przebieg młodszy niż to okno znaczy „dzisiejszy zaciąg już był”. */
export const MARKET_RUN_WINDOW_MS = 12 * 3_600_000;

export type MarketRunDecision =
  | { run: true }
  | { run: false; reason: "recent_run"; lastFinishedAt: string }
  | { run: false; reason: "off_hours" };

/**
 * Czy ten przebieg joba ma działać.
 *
 * Tylko przebieg z crona GitHuba (`schedule`) bywa zbędny — ręczne
 * uruchomienie i wywołanie z bazy (`workflow_dispatch`) zawsze ruszają, bo
 * ktoś (albo baza po sprawdzeniu, że przebiegu nie było) świadomie go chce.
 *
 * `lastFinishedAt` = ostatni przebieg TEJ SAMEJ sesji (lastRunOfSession) —
 * poranny nie może wstrzymać wieczornego. Cron, który spóźnił się poza obie
 * sesje (14:00–19:00), nic nie robi: poranne decyzje po południu byłyby
 * spóźnione, a wieczorne za wczesne.
 */
export function decideMarketRun(
  event: string | undefined,
  lastFinishedAt: string | null,
  now: Date,
): MarketRunDecision {
  if (event !== "schedule") return { run: true };
  const h = warsawHour(now);
  if (h >= SESSION_SPLIT_HOUR && h < MARKET_HOUR - 1) return { run: false, reason: "off_hours" };
  if (!lastFinishedAt) return { run: true };
  const age = now.getTime() - new Date(lastFinishedAt).getTime();
  if (age >= 0 && age < MARKET_RUN_WINDOW_MS) {
    return { run: false, reason: "recent_run", lastFinishedAt };
  }
  return { run: true };
}
