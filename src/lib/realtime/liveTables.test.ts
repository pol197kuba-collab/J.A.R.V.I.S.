import { describe, expect, it, vi } from "vitest";
import { createLiveHub, LIVE_TABLES, LIVE_THROTTLE_MS, type LiveTable } from "./liveTables";

function setup() {
  const listeners = new Map<string, () => void>();
  const opened: LiveTable[] = [];
  const closed: string[] = [];
  const api = {
    open: (table: LiveTable, onChange: () => void) => {
      opened.push(table);
      const handle = `ch:${table}:${opened.length}`;
      listeners.set(table, onChange);
      return handle;
    },
    close: (handle: unknown) => {
      closed.push(String(handle));
    },
  };
  const pending: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const timers = {
    set: (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      pending.push(t);
      return t;
    },
    clear: (h: unknown) => {
      (h as { cleared: boolean }).cleared = true;
    },
  };
  const invalidate = vi.fn();
  const hub = createLiveHub(api, invalidate, timers);
  const runTimers = () => {
    for (const t of pending.splice(0)) if (!t.cleared) t.fn();
  };
  const fire = (table: string) => listeners.get(table)?.();
  return { hub, opened, closed, invalidate, pending, runTimers, fire };
}

describe("createLiveHub", () => {
  it("jeden kanał na tabelę, niezależnie od liczby komponentów", () => {
    const { hub, opened } = setup();
    hub.acquire(["agents", "agent_runs"]);
    hub.acquire(["agents"]);
    hub.acquire(["agents", "agents"]);
    expect(opened).toEqual(["agents", "agent_runs"]);
    expect(hub.openTables().sort()).toEqual(["agent_runs", "agents"]);
  });

  it("zamyka kanał dopiero przy odmontowaniu ostatniego komponentu", () => {
    const { hub, closed } = setup();
    const a = hub.acquire(["notes"]);
    const b = hub.acquire(["notes"]);
    a();
    expect(closed).toEqual([]);
    b();
    expect(closed).toEqual(["ch:notes:1"]);
    expect(hub.openTables()).toEqual([]);
  });

  it("podwójne wycofanie nie zamyka cudzego kanału", () => {
    const { hub, closed } = setup();
    const a = hub.acquire(["tasks"]);
    hub.acquire(["tasks"]);
    a();
    a();
    expect(closed).toEqual([]);
  });

  it("seria zmian daje jedno unieważnienie kluczy tabeli po przerwie", () => {
    const { hub, fire, pending, runTimers, invalidate } = setup();
    hub.acquire(["generated_files"]);
    fire("generated_files");
    fire("generated_files");
    fire("generated_files");
    expect(pending).toHaveLength(1);
    expect(pending[0].ms).toBe(LIVE_THROTTLE_MS);
    expect(invalidate).not.toHaveBeenCalled();
    runTimers();
    expect(invalidate.mock.calls.map((c) => c[0])).toEqual(
      LIVE_TABLES.generated_files.map((k) => [...k]),
    );
    // Po odświeżeniu kolejna zmiana znowu planuje odświeżenie.
    fire("generated_files");
    expect(pending).toHaveLength(1);
  });

  it("zamknięcie kanału anuluje zaplanowane odświeżenie", () => {
    const { hub, fire, pending, runTimers, invalidate } = setup();
    const release = hub.acquire(["documents"]);
    fire("documents");
    release();
    expect(pending[0].cleared).toBe(true);
    runTimers();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("ponowne otwarcie po zamknięciu tworzy nowy kanał", () => {
    const { hub, opened } = setup();
    hub.acquire(["system_events"])();
    hub.acquire(["system_events"]);
    expect(opened).toEqual(["system_events", "system_events"]);
  });
});

describe("LIVE_TABLES", () => {
  it("klucze odpowiadają tym, których używają moduły", () => {
    expect(LIVE_TABLES.agents).toContainEqual(["agents"]);
    expect(LIVE_TABLES.agent_runs).toContainEqual(["agent"]);
    expect(LIVE_TABLES.system_events).toEqual([["system-events"], ["system_events"]]);
    expect(LIVE_TABLES.generated_files).toContainEqual(["agents", "flow"]);
  });
});
