import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runOrchestrator, UI_ACTION_CONFIRMATIONS } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

// TESTY CHARAKTERYZUJĄCE runOrchestrator (plan naprawczy, etap 0).
//
// Opisują zachowanie rdzenia agentów TAKIM, JAKIE JEST (commit 4260049),
// żeby kolejne etapy (bramka narzędzi, księga kosztów, rozbicie rdzenia)
// miały czym wykryć regresję. Niektóre asercje utrwalają znane usterki
// z rewizji — są oznaczone „STAN OBECNY (Axx)”. Etap, który daną usterkę
// naprawia, zmienia TĘ asercję świadomie, razem z kodem.
//
// Każdy scenariusz sprawdza trzy rzeczy: tekst końcowy, listę wywołań
// narzędzi i to, co trafiło do agent_runs (status, tokeny, koszt).

// ---------- atrapa klienta bazy z zapisem wywołań ----------

type Canned = { data: unknown; error: { message: string } | null };
type Op = { method: string; args: unknown[] };
type DbCall = { table: string; ops: Op[] };
type Resolver = (table: string, ops: Op[]) => Canned | undefined;

const EMPTY: Canned = { data: null, error: null };

// Każde `.from(table)` zapisuje cały łańcuch metod; `await` w dowolnym
// miejscu łańcucha pyta resolver o odpowiedź dla tego łańcucha. Dzięki
// temu odpowiedzi zależą od operacji (select / insert / update i filtrów),
// a nie od kolejności wywołań — test nie pęknie od przestawienia zapytań.
function makeDb(resolve: Resolver) {
  const calls: DbCall[] = [];
  const db = {
    from(table: string) {
      const call: DbCall = { table, ops: [] };
      calls.push(call);
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (ok: (v: Canned) => unknown, fail: (e: unknown) => unknown) =>
                Promise.resolve(resolve(table, call.ops) ?? EMPTY).then(ok, fail);
            }
            return (...args: unknown[]) => {
              call.ops.push({ method: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

const has = (ops: Op[], method: string) => ops.some((o) => o.method === method);
const eqValue = (ops: Op[], column: string) =>
  ops.find((o) => o.method === "eq" && o.args[0] === column)?.args[1];
const firstArg = (ops: Op[], method: string) =>
  ops.find((o) => o.method === method)?.args[0] as Record<string, unknown> | undefined;

function writes(calls: DbCall[], table: string, method: "insert" | "update") {
  return calls
    .filter((c) => c.table === table && has(c.ops, method))
    .map((c) => ({ payload: firstArg(c.ops, method)!, id: eqValue(c.ops, "id") }));
}

/** Aktualizacje wiersza agent_runs o danym id, w kolejności. */
const runUpdates = (calls: DbCall[], runId: string) =>
  writes(calls, "agent_runs", "update")
    .filter((w) => w.id === runId)
    .map((w) => w.payload);

/** Ostatnia aktualizacja z polem status — to, co zostaje w wierszu na koniec. */
const finalRunRow = (calls: DbCall[], runId: string) =>
  runUpdates(calls, runId)
    .filter((p) => "status" in p)
    .at(-1);

const loggedMessages = (calls: DbCall[]) =>
  writes(calls, "system_events", "insert").map((w) => String(w.payload.message));

// ---------- świat: agenci, klucze, narzędzia ----------

type AgentRow = {
  id: string;
  name: string;
  slug: string;
  model: string;
  config: Record<string, unknown>;
  role?: string | null;
  description?: string | null;
  is_enabled?: boolean;
};

type World = {
  agents: AgentRow[];
  secrets: {
    gemini_api_key: string;
    groq_api_key: string | null;
    anthropic_api_key: string | null;
  };
  /** Narzędzia z bazy przypięte do KAŻDEGO agenta (agent_tools + tools). */
  toolSlugs?: string[];
  notes?: Array<Record<string, unknown>>;
};

const HERALD: AgentRow = {
  id: "agent-herald",
  name: "H.E.R.A.L.D.",
  slug: AGENT_SLUGS.HERALD,
  model: "gemini-2.5-flash",
  config: {},
  role: "copywriter",
  is_enabled: true,
};
const JARVIS: AgentRow = {
  id: "agent-jarvis",
  name: "J.A.R.V.I.S.",
  slug: AGENT_SLUGS.JARVIS,
  model: "gemini-2.5-flash",
  config: {},
  is_enabled: true,
};
const FORGE: AgentRow = {
  id: "agent-forge",
  name: "F.O.R.G.E.",
  slug: AGENT_SLUGS.FORGE,
  model: "gemini-2.5-flash",
  config: {},
  is_enabled: true,
};

function worldDb(world: World) {
  let runSeq = 0;
  return makeDb((table, ops) => {
    switch (table) {
      case "agents": {
        if (has(ops, "update")) return EMPTY;
        if (has(ops, "order")) return { data: world.agents, error: null }; // skład zespołu
        const slug = eqValue(ops, "slug");
        return { data: world.agents.find((a) => a.slug === slug) ?? null, error: null };
      }
      case "user_secrets":
        return { data: world.secrets, error: null };
      case "agent_runs":
        if (has(ops, "insert")) return { data: { id: `run-${++runSeq}` }, error: null };
        if (has(ops, "select")) return { data: [], error: null }; // budżet: brak wydatków
        return EMPTY;
      case "agent_tools":
        return {
          data: (world.toolSlugs ?? []).map((s) => ({ tool_id: `tool-${s}` })),
          error: null,
        };
      case "tools":
        return { data: (world.toolSlugs ?? []).map((slug) => ({ slug })), error: null };
      case "conversations":
        if (has(ops, "insert")) return { data: { id: "conv-1" }, error: null };
        return EMPTY;
      case "notes":
        return { data: world.notes ?? [], error: null };
      case "agent_variants":
        return { data: [], error: null };
      default:
        return EMPTY;
    }
  });
}

// ---------- atrapy odpowiedzi dostawców ----------

type Usage = { in: number; out: number };

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const geminiText = (text: string, u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

const geminiCall = (name: string, args: Record<string, unknown>, u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

const geminiEmpty = (u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

const groqText = (text: string, u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: u.in, completion_tokens: u.out },
  });

const groqCall = (name: string, args: Record<string, unknown>) =>
  json(200, {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 40, completion_tokens: 5 },
  });

const isGemini = (url: unknown) => String(url).includes("generativelanguage.googleapis.com");
const isGroq = (url: unknown) => String(url).includes("api.groq.com");
const isAnthropic = (url: unknown) => String(url).includes("api.anthropic.com");

/** Kolejka odpowiedzi osobno dla każdego dostawcy (ostatnia się powtarza). */
function providerFetch(queues: { gemini?: unknown[]; groq?: unknown[]; anthropic?: unknown[] }) {
  const take = (q: unknown[] | undefined, who: string) => {
    if (!q || q.length === 0) throw new Error(`nieoczekiwane wywołanie ${who}`);
    return q.length > 1 ? q.shift() : q[0];
  };
  return vi.fn(async (url: unknown, _init?: RequestInit) => {
    if (isGemini(url)) return take(queues.gemini, "Gemini");
    if (isGroq(url)) return take(queues.groq, "Groq");
    if (isAnthropic(url)) return take(queues.anthropic, "Anthropic");
    throw new Error(`nieoczekiwany adres: ${String(url)}`);
  });
}

type FetchMock = ReturnType<typeof providerFetch>;
const geminiBodies = (f: FetchMock) =>
  f.mock.calls
    .filter((c) => isGemini(c[0]))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);

const toolNames = (output: unknown) =>
  ((output as { tool_calls?: Array<{ name: string }> }).tool_calls ?? []).map((c) => c.name);

const KEYS_GEMINI_ONLY = { gemini_api_key: "gem", groq_api_key: null, anthropic_api_key: null };
const KEYS_WITH_GROQ = { gemini_api_key: "gem", groq_api_key: "groq", anthropic_api_key: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- scenariusze ----------

describe("runOrchestrator — charakterystyka (etap 0)", () => {
  it("1. zwykła odpowiedź bez narzędzi: tekst modelu, klasyfikator Groq mówi „none”", async () => {
    const fetchMock = providerFetch({
      gemini: [geminiText("Dzień dobry, Panie Sławiński.", { in: 1000, out: 200 })],
      groq: [groqCall("perform_ui_action", { action: "none" })],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_WITH_GROQ });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Cześć",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Dzień dobry, Panie Sławiński.");
    expect(result.action).toBeUndefined();
    expect(result.conversationId).toBe("conv-1");

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    // Wpis klasyfikatora ląduje na liście wywołań narzędzi.
    expect(toolNames(row.output)).toEqual(["classifier_none"]);
    expect((row.output as { text: string }).text).toBe(result.output);
    // STAN OBECNY (A9/A20): tokeny klasyfikatora Groq nie są liczone.
    expect(row.tokens_input).toBe(1000);
    expect(row.tokens_output).toBe(200);
    expect(row.model).toBe("gemini-2.5-flash");
    expect(row.cost_usd).toBeCloseTo(0.0008, 6); // 1000 × $0,3/M + 200 × $2,5/M

    // Tura trafia do historii rozmowy: wiadomość użytkownika + odpowiedź.
    const msgs = writes(calls, "messages", "insert")[0].payload as unknown as Array<{
      role: string;
      content: string;
    }>;
    expect(msgs.map((m) => m.role)).toEqual(["user", "jarvis"]);
    expect(msgs[1].content).toBe(result.output);
  });

  it("2. jedno narzędzie i odpowiedź: wynik narzędzia wraca do modelu, klasyfikatora brak", async () => {
    const fetchMock = providerFetch({
      gemini: [
        geminiCall("list_notes", {}, { in: 500, out: 20 }),
        geminiText("Masz jedną notatkę: Zakupy.", { in: 700, out: 30 }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [HERALD],
      secrets: KEYS_GEMINI_ONLY,
      toolSlugs: ["list_notes"],
      notes: [{ id: "n1", title: "Zakupy", body: "mleko", tags: [], created_at: "2026-11-01" }],
    });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Jakie mam notatki?",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Masz jedną notatkę: Zakupy.");
    // Dwie tury modelu i żadnego klasyfikatora (padło wywołanie narzędzia).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = geminiBodies(fetchMock)[1];
    const contents = second.contents as Array<{ role: string; parts: unknown[] }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "function"]);
    expect(JSON.stringify(contents[2])).toContain("Zakupy");

    // Podgląd na żywo po iteracji, potem wiersz końcowy.
    const updates = runUpdates(calls, "run-1");
    expect(toolNames(updates[0].output)).toEqual(["list_notes"]);
    expect(updates[0].status).toBeUndefined();

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual(["list_notes"]);
    expect(row.tokens_input).toBe(1200);
    expect(row.tokens_output).toBe(50);
    expect(row.cost_usd).toBeCloseTo(0.000485, 6); // 1200 × 0,3/M + 50 × 2,5/M
  });

  it("3. delegacja do kolegi: osobny run dziecka, odpowiedź wraca do J.A.R.V.I.S.", async () => {
    const fetchMock = providerFetch({
      gemini: [
        geminiCall(
          "delegate_to_agent",
          { slug: AGENT_SLUGS.HERALD, task: "Napisz hasło kampanii." },
          { in: 800, out: 40 },
        ),
        geminiText("Hasło: Zawsze o krok przed.", { in: 300, out: 20 }), // run Heralda
        geminiText("Herald proponuje: Zawsze o krok przed.", { in: 900, out: 25 }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [JARVIS, HERALD], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.JARVIS,
      input: "Niech Herald wymyśli hasło kampanii.",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Herald proponuje: Zawsze o krok przed.");
    expect(fetchMock).toHaveBeenCalledTimes(3); // bez klasyfikatora w żadnym z runów

    // Delegat dostaje własny wiersz z rodzicem.
    const inserts = writes(calls, "agent_runs", "insert").map((w) => w.payload);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ agent_id: JARVIS.id, parent_run_id: null });
    expect(inserts[1]).toMatchObject({ agent_id: HERALD.id, parent_run_id: "run-1" });

    // Odpowiedź delegata trafia do trzeciej tury J.A.R.V.I.S. jako wynik narzędzia.
    const third = geminiBodies(fetchMock)[2];
    expect(JSON.stringify(third.contents)).toContain("Zawsze o krok przed.");

    const child = finalRunRow(calls, "run-2")!;
    expect(child.status).toBe("done");
    expect(toolNames(child.output)).toEqual([]);
    expect(child.tokens_input).toBe(300);
    expect(child.tokens_output).toBe(20);

    const parent = finalRunRow(calls, "run-1")!;
    expect(parent.status).toBe("done");
    expect(toolNames(parent.output)).toEqual(["delegate_to_agent"]);
    // Tokeny rodzica to tylko jego własne tury — dziecko liczy się osobno.
    expect(parent.tokens_input).toBe(1700);
    expect(parent.tokens_output).toBe(65);
    expect(parent.cost_usd).toBe(0.000672); // zaokrąglone do 6 miejsc w costUsd

    // Rozmowę i jej wiadomości zakłada tylko run najwyższego poziomu.
    expect(writes(calls, "conversations", "insert")).toHaveLength(1);
    expect(writes(calls, "messages", "insert")).toHaveLength(1);
  });

  it("4. F.O.R.G.E.: wymuszony generate_document w pierwszej turze, potem tryb AUTO", async () => {
    const fetchMock = providerFetch({
      gemini: [
        // Pusta specyfikacja → narzędzie odrzuca ją bez budowania pliku.
        geminiCall("generate_document", {}, { in: 400, out: 10 }),
        geminiText("Nie udało się zbudować pliku.", { in: 450, out: 12 }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    // Brak powiązań w bazie: narzędzie i tak jest deklarowane w pamięci.
    const { db, calls } = worldDb({ agents: [FORGE], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.FORGE,
      input: "Zrób prezentację o Warszawie.",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Nie udało się zbudować pliku.");
    expect(result.attachments).toBeUndefined();

    const [first, second] = geminiBodies(fetchMock);
    expect(first.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["generate_document"] },
    });
    expect((first.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
    // Po pierwszej próbie (nawet nieudanej) wymuszenie znika.
    expect(second.toolConfig).toBeUndefined();
    expect((second.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
    expect(JSON.stringify(second.contents)).toContain('"error"');

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual(["generate_document"]);
    expect(row.tokens_input).toBe(850);
    expect(row.tokens_output).toBe(22);
  });

  it("5. wyczerpanie limitu iteracji: stały komunikat, status done", async () => {
    const fetchMock = providerFetch({
      gemini: [geminiCall("list_notes", {}, { in: 100, out: 5 })], // w kółko to samo
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [{ ...HERALD, config: { max_tool_iterations: 2 } }],
      secrets: KEYS_GEMINI_ONLY,
      toolSlugs: ["list_notes"],
    });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Notatki?",
      history: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("done");
    expect(result.output).toBe(
      "I have completed several tool calls but ran out of orchestration cycles. Please rephrase or ask me to continue.",
    );

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual(["list_notes", "list_notes"]);
    expect(row.tokens_input).toBe(200);
    expect(row.tokens_output).toBe(10);
  });

  it("6. błąd dostawcy bez Groq: run kończy się błędem", async () => {
    const fetchMock = providerFetch({
      gemini: [
        geminiCall("list_notes", {}, { in: 600, out: 15 }),
        json(400, "API key expired"), // 400 nie jest ponawiane
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [HERALD],
      secrets: KEYS_GEMINI_ONLY,
      toolSlugs: ["list_notes"],
    });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Notatki?",
      history: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("error");
    expect(result.output).toBe("");
    expect(result.error).toBe("Gemini HTTP 400: API key expired");

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("error");
    expect(row.error).toBe("Gemini HTTP 400: API key expired");
    // STAN OBECNY (A4): tokeny pierwszej, udanej tury przepadają — wiersz
    // błędu nie ma tokenów ani kosztu. Etap 2 zmienia tę asercję.
    expect(row).not.toHaveProperty("tokens_input");
    expect(row).not.toHaveProperty("cost_usd");

    const agentUpdates = writes(calls, "agents", "update").map((w) => w.payload);
    expect(agentUpdates.at(-1)).toMatchObject({ status: "error" });
    expect(writes(calls, "messages", "insert")).toHaveLength(0);
    expect(loggedMessages(calls)).toContain("run failed: Gemini HTTP 400: API key expired");
  });

  it("6b. błąd Gemini z kluczem Groq: tura przechodzi na Groq", async () => {
    const fetchMock = providerFetch({
      gemini: [json(400, "bad request")],
      groq: [groqText("Odpowiedź z Groq.", { in: 300, out: 40 })],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_WITH_GROQ });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Odpowiedź z Groq.");

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(row.tokens_input).toBe(300);
    expect(row.tokens_output).toBe(40);
    // STAN OBECNY (A20): tokeny Groq zapisane pod modelem Gemini i wycenione
    // po jego stawce. Etap 2 zmienia tę asercję.
    expect(row.model).toBe("gemini-2.5-flash");
    expect(row.cost_usd).toBeCloseTo(0.00019, 6);
    expect(loggedMessages(calls)).toContain("failover to groq succeeded");
  });

  it("7. failover Claude → Gemini: run kończy się na Gemini i tak jest wyceniony", async () => {
    const fetchMock = providerFetch({
      anthropic: [json(400, '{"error":{"message":"credit balance is too low"}}')],
      gemini: [geminiText("Gotowe.", { in: 1000, out: 100 })],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({
      agents: [{ ...HERALD, model: "anthropic:claude-opus-5" }],
      secrets: { ...KEYS_GEMINI_ONLY, anthropic_api_key: "sk-ant" },
    });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Cześć",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Gotowe.");
    const order = fetchMock.mock.calls.map((c) => (isAnthropic(c[0]) ? "claude" : "gemini"));
    expect(order).toEqual(["claude", "gemini"]);

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual([]);
    expect(row.model).toBe("gemini-2.5-flash");
    expect(row.tokens_input).toBe(1000);
    expect(row.tokens_output).toBe(100);
    expect(row.cost_usd).toBeCloseTo(0.00055, 6);
    expect(
      loggedMessages(calls).some((m) => m.startsWith("Claude (claude-opus-5) nie odpowiedział")),
    ).toBe(true);
  });

  it("8. pusta tura Gemini: jedna powtórka bez myślenia, tokeny obu prób się sumują", async () => {
    const fetchMock = providerFetch({
      gemini: [
        geminiEmpty({ in: 500, out: 0 }),
        geminiText("Raport gotowy.", { in: 500, out: 60 }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Co się wywaliło?",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Raport gotowy.");
    const [first, second] = geminiBodies(fetchMock);
    expect((first.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
    expect((second.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 0,
    });

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual([]);
    expect(row.tokens_input).toBe(1000);
    expect(row.tokens_output).toBe(60);
    expect(loggedMessages(calls).some((m) => m.startsWith("pusta tura Gemini"))).toBe(true);
  });

  it("9a. klasyfikator UI (Groq) po turze bez narzędzi: akcja nadpisuje tekst odpowiedzi", async () => {
    const fetchMock = providerFetch({
      gemini: [geminiText("Nie mam dostępu do interfejsu.", { in: 900, out: 30 })],
      groq: [groqCall("perform_ui_action", { action: "open_tasks" })],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_WITH_GROQ });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "pokaż zadania",
      history: [],
    });

    expect(result.status).toBe("done");
    expect(result.action).toBe("open_tasks");
    expect(result.output).toBe(UI_ACTION_CONFIRMATIONS.open_tasks);

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(row.output).toMatchObject({
      text: UI_ACTION_CONFIRMATIONS.open_tasks,
      tool_calls: [
        {
          name: "perform_ui_action",
          args: { action: "open_tasks", via: "classifier_fallback_groq" },
        },
      ],
    });
    // Groq: tokeny klasyfikatora poza runem (STAN OBECNY, A9/A20).
    expect(row.tokens_input).toBe(900);
    expect(row.tokens_output).toBe(30);
  });

  it("9b. klasyfikator UI bez Groq: druga płatna tura Gemini, jej tokeny wchodzą do runu", async () => {
    const fetchMock = providerFetch({
      gemini: [
        geminiText("Zwykła odpowiedź.", { in: 900, out: 30 }),
        geminiCall("perform_ui_action", { action: "none" }, { in: 120, out: 3 }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Jak się masz?",
      history: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output).toBe("Zwykła odpowiedź.");
    expect(result.action).toBeUndefined();

    const classifierBody = geminiBodies(fetchMock)[1];
    expect(classifierBody.toolConfig).toMatchObject({ functionCallingConfig: { mode: "ANY" } });

    const row = finalRunRow(calls, "run-1")!;
    expect(row.status).toBe("done");
    expect(toolNames(row.output)).toEqual(["classifier_none"]);
    expect(row.tokens_input).toBe(1020);
    expect(row.tokens_output).toBe(33);
  });
});
