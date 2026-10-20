// Kiedy biegnie Market Grid — czysta decyzja, bez bazy i bez zegara systemowego.
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

/** Godzina warszawska, o której baza uruchamia Market Grid (w SQL ta sama stała). */
export const MARKET_HOUR = 20;

/** Przebieg młodszy niż to okno znaczy „dzisiejszy zaciąg już był”. */
export const MARKET_RUN_WINDOW_MS = 12 * 3_600_000;

export type MarketRunDecision =
  | { run: true }
  | { run: false; reason: "recent_run"; lastFinishedAt: string };

/**
 * Czy ten przebieg joba ma działać.
 *
 * Tylko przebieg z crona GitHuba (`schedule`) bywa zbędny — ręczne
 * uruchomienie i wywołanie z bazy (`workflow_dispatch`) zawsze ruszają, bo
 * ktoś (albo baza po sprawdzeniu, że przebiegu nie było) świadomie go chce.
 */
export function decideMarketRun(
  event: string | undefined,
  lastFinishedAt: string | null,
  now: Date,
): MarketRunDecision {
  if (event !== "schedule" || !lastFinishedAt) return { run: true };
  const age = now.getTime() - new Date(lastFinishedAt).getTime();
  if (age >= 0 && age < MARKET_RUN_WINDOW_MS) {
    return { run: false, reason: "recent_run", lastFinishedAt };
  }
  return { run: true };
}
