// Atrapy do testów runOrchestrator: klient bazy zapisujący każde wywołanie
// i kolejki odpowiedzi dostawców modeli. Wydzielone z testów
// charakteryzujących (etap 0), używane też przez testy bramki narzędzi
// (etap 1). Tylko dla testów — nic z produkcji tego nie importuje.

import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { testSecretsDb } from "@/test/secretsDb";

// ---------- atrapa klienta bazy z zapisem wywołań ----------

export type Canned = { data: unknown; error: { message: string } | null };
export type Op = { method: string; args: unknown[] };
export type DbCall = { table: string; ops: Op[] };
export type Resolver = (table: string, ops: Op[]) => Canned | undefined;

export const EMPTY: Canned = { data: null, error: null };

// Każde `.from(table)` zapisuje cały łańcuch metod; `await` w dowolnym
// miejscu łańcucha pyta resolver o odpowiedź dla tego łańcucha. Dzięki
// temu odpowiedzi zależą od operacji (select / insert / update i filtrów),
// a nie od kolejności wywołań — test nie pęknie od przestawienia zapytań.
export function makeDb(resolve: Resolver) {
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
    // rpc(name, params) — zapisane jako tabela `rpc:<name>`.
    rpc(name: string, params: unknown) {
      const call: DbCall = { table: `rpc:${name}`, ops: [{ method: "rpc", args: [name, params] }] };
      calls.push(call);
      return Promise.resolve(resolve(call.table, call.ops) ?? EMPTY);
    },
  } as unknown as SupabaseClient<Database>;
  // Etap 5 (A5): user_secrets czyta klient service role — w testach ta sama atrapa.
  testSecretsDb.current = db;
  return { db, calls };
}

export const has = (ops: Op[], method: string) => ops.some((o) => o.method === method);
export const eqValue = (ops: Op[], column: string) =>
  ops.find((o) => o.method === "eq" && o.args[0] === column)?.args[1];
export const firstArg = (ops: Op[], method: string) =>
  ops.find((o) => o.method === method)?.args[0] as Record<string, unknown> | undefined;

export function writes(calls: DbCall[], table: string, method: "insert" | "update") {
  return calls
    .filter((c) => c.table === table && has(c.ops, method))
    .map((c) => ({ payload: firstArg(c.ops, method)!, id: eqValue(c.ops, "id") }));
}

/** Aktualizacje wiersza agent_runs o danym id, w kolejności. */
export const runUpdates = (calls: DbCall[], runId: string) =>
  writes(calls, "agent_runs", "update")
    .filter((w) => w.id === runId)
    .map((w) => w.payload);

/** Ostatnia aktualizacja z polem status — to, co zostaje w wierszu na koniec. */
export const finalRunRow = (calls: DbCall[], runId: string) =>
  runUpdates(calls, runId)
    .filter((p) => "status" in p)
    .at(-1);

export const loggedMessages = (calls: DbCall[]) =>
  writes(calls, "system_events", "insert").map((w) => String(w.payload.message));

// ---------- świat: agenci, klucze, narzędzia ----------

export type AgentRow = {
  id: string;
  name: string;
  slug: string;
  model: string;
  config: Record<string, unknown>;
  role?: string | null;
  description?: string | null;
  is_enabled?: boolean;
};

export type World = {
  agents: AgentRow[];
  secrets: {
    gemini_api_key: string;
    groq_api_key: string | null;
    anthropic_api_key: string | null;
  };
  /** Narzędzia z bazy przypięte do KAŻDEGO agenta (agent_tools + tools). */
  toolSlugs?: string[];
  notes?: Array<Record<string, unknown>>;
  /** Własne odpowiedzi dla wybranych tabel; `undefined` → domyślne poniżej. */
  extra?: Resolver;
};

export const HERALD: AgentRow = {
  id: "agent-herald",
  name: "H.E.R.A.L.D.",
  slug: AGENT_SLUGS.HERALD,
  model: "gemini-2.5-flash",
  config: {},
  role: "copywriter",
  is_enabled: true,
};
export const JARVIS: AgentRow = {
  id: "agent-jarvis",
  name: "J.A.R.V.I.S.",
  slug: AGENT_SLUGS.JARVIS,
  model: "gemini-2.5-flash",
  config: {},
  is_enabled: true,
};
export const FORGE: AgentRow = {
  id: "agent-forge",
  name: "F.O.R.G.E.",
  slug: AGENT_SLUGS.FORGE,
  model: "gemini-2.5-flash",
  config: {},
  is_enabled: true,
};

export function worldDb(world: World) {
  let runSeq = 0;
  return makeDb((table, ops) => {
    const custom = world.extra?.(table, ops);
    if (custom) return custom;
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

export type Usage = { in: number; out: number };

export const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export const geminiText = (text: string, u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

export const geminiCall = (
  name: string,
  args: Record<string, unknown>,
  u: Usage = { in: 0, out: 0 },
) =>
  json(200, {
    candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

export const geminiEmpty = (u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out },
  });

export const groqText = (text: string, u: Usage = { in: 0, out: 0 }) =>
  json(200, {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: u.in, completion_tokens: u.out },
  });

export const groqCall = (name: string, args: Record<string, unknown>) =>
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

export const isGemini = (url: unknown) => String(url).includes("generativelanguage.googleapis.com");
export const isGroq = (url: unknown) => String(url).includes("api.groq.com");
export const isAnthropic = (url: unknown) => String(url).includes("api.anthropic.com");

/** Kolejka odpowiedzi osobno dla każdego dostawcy (ostatnia się powtarza). */
export function providerFetch(queues: {
  gemini?: unknown[];
  groq?: unknown[];
  anthropic?: unknown[];
}) {
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

export type FetchMock = ReturnType<typeof providerFetch>;
export const geminiBodies = (f: FetchMock) =>
  f.mock.calls
    .filter((c) => isGemini(c[0]))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);

export const toolNames = (output: unknown) =>
  ((output as { tool_calls?: Array<{ name: string }> }).tool_calls ?? []).map((c) => c.name);

export const KEYS_GEMINI_ONLY = {
  gemini_api_key: "gem",
  groq_api_key: null,
  anthropic_api_key: null,
};
export const KEYS_WITH_GROQ = {
  gemini_api_key: "gem",
  groq_api_key: "groq",
  anthropic_api_key: null,
};
