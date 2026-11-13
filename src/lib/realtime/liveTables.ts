// Odświeżanie na żywo zamiast szybkiego odpytywania (plan naprawczy, etap 7, A15).
//
// Zmiana w tabeli (postgres_changes z Supabase Realtime) unieważnia klucze
// zapytań, które z niej czytają. Kanał na tabelę jest jeden na całą aplikację
// (licznik odwołań): otwiera go pierwszy komponent, który go potrzebuje,
// zamyka ostatni przy odmontowaniu. Wszystkie kanały idą jednym połączeniem
// WebSocket klienta Supabase. `refetchInterval` zostaje jako rzadki zapas
// (LIVE_FALLBACK_MS) — na wypadek zerwanego połączenia.
//
// Plik bez Reacta i bez klienta Supabase — logika jest testowana atrapami.

/** Zapasowe odpytywanie dla zapytań odświeżanych na żywo. */
export const LIVE_FALLBACK_MS = 60_000;

/**
 * Ile czekamy po zmianie, zanim unieważnimy klucze. Agent w trakcie pracy
 * zapisuje postęp wiele razy na sekundę — seria zmian daje jedno odświeżenie.
 */
export const LIVE_THROTTLE_MS = 500;

/**
 * Tabela → prefiksy kluczy zapytań, które z niej czytają. Prefiks unieważnia
 * wszystkie klucze, które się od niego zaczynają (TanStack Query), a odświeżane
 * są tylko zapytania aktualnie na ekranie.
 */
export const LIVE_TABLES = {
  // listAgents, getAgentFlow, getAgentDetail
  agents: [["agents"], ["agent"]],
  agent_runs: [["agents"], ["agent"]],
  // listSystemEvents (dwa style kluczy w kodzie: myślnik i podkreślnik)
  system_events: [["system-events"], ["system_events"]],
  tasks: [["tasks"]],
  notes: [["notes"]],
  documents: [["documents"]],
  // getAgentFlow pokazuje też ostatnie wygenerowane pliki
  generated_files: [["generated-files"], ["agents", "flow"]],
} as const satisfies Record<string, ReadonlyArray<readonly string[]>>;

export type LiveTable = keyof typeof LIVE_TABLES;

/** Co hub potrzebuje od klienta Supabase (atrapa w testach). */
export type LiveChannelApi = {
  /** Otwiera kanał nasłuchujący wszystkich zmian tabeli; zwraca uchwyt do zamknięcia. */
  open(table: LiveTable, onChange: () => void): unknown;
  close(handle: unknown): void;
};

export type LiveTimers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

type Entry = { handle: unknown; refs: number; timer: unknown | null };

export type LiveHub = {
  /** Zgłasza potrzebę tabel; zwraca funkcję, która ją wycofuje. */
  acquire(tables: readonly LiveTable[]): () => void;
  /** Otwarte kanały (do testów i diagnostyki). */
  openTables(): LiveTable[];
};

export function createLiveHub(
  api: LiveChannelApi,
  invalidate: (queryKey: readonly string[]) => void,
  timers: LiveTimers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): LiveHub {
  const entries = new Map<LiveTable, Entry>();

  const flush = (table: LiveTable) => {
    const entry = entries.get(table);
    if (entry) entry.timer = null;
    for (const key of LIVE_TABLES[table]) invalidate(key);
  };

  const onChange = (table: LiveTable) => {
    const entry = entries.get(table);
    if (!entry || entry.timer !== null) return;
    entry.timer = timers.set(() => flush(table), LIVE_THROTTLE_MS);
  };

  const release = (table: LiveTable) => {
    const entry = entries.get(table);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (entry.timer !== null) timers.clear(entry.timer);
    entries.delete(table);
    api.close(entry.handle);
  };

  return {
    acquire(tables) {
      const unique = [...new Set(tables)];
      for (const table of unique) {
        const entry = entries.get(table);
        if (entry) {
          entry.refs += 1;
          continue;
        }
        const fresh: Entry = { handle: null, refs: 1, timer: null };
        entries.set(table, fresh);
        fresh.handle = api.open(table, () => onChange(table));
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const table of unique) release(table);
      };
    },
    openTables: () => [...entries.keys()],
  };
}
