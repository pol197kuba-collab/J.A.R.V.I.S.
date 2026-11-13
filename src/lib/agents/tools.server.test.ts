import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// isBlockedTarget resolves hostnames via dns.lookup — stub it so tests are
// deterministic and never touch the network.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import {
  isPrivateIp,
  isBlockedTarget,
  ALL_TOOLS,
  getToolByName,
  toolRisk,
  bringsUntrustedContent,
  type ToolContext,
  FETCH_MAX_BYTES,
  FETCH_TIMEOUT_MS,
  SIGNED_URL_TTL_SECONDS,
} from "./tools.server";
import { makeDb } from "./runtime.testkit";

const lookupMock = vi.mocked(lookup);

// The SSRF guard protects agent-driven fetch_url calls (URL chosen by the
// model, steerable via prompt injection) from reaching cloud metadata and
// internal services. A regression here is a security hole, so the ranges
// are pinned exhaustively.
describe("isPrivateIp", () => {
  it("blocks IPv4 loopback, RFC1918 and link-local ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
      "169.254.169.254", // cloud metadata endpoint
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4 addresses, including 172.x outside /12", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "1.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local and link-local", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "FE80::1".toLowerCase()]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("unwraps IPv4-mapped IPv6 (::ffff:...) instead of letting it bypass the v4 rules", () => {
    expect(isPrivateIp("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("treats non-IP input as private (fail closed)", () => {
    expect(isPrivateIp("example.com")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("isBlockedTarget", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("blocks well-known internal hostnames without touching DNS", async () => {
    expect(await isBlockedTarget("localhost")).toBe(true);
    expect(await isBlockedTarget("LOCALHOST")).toBe(true);
    expect(await isBlockedTarget("foo.localhost")).toBe(true);
    expect(await isBlockedTarget("metadata.google.internal")).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("evaluates literal IPs directly, without DNS", async () => {
    expect(await isBlockedTarget("169.254.169.254")).toBe(true);
    expect(await isBlockedTarget("8.8.8.8")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks a public hostname that resolves to an internal IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    expect(await isBlockedTarget("evil-rebind.example.com")).toBe(true);
  });

  it("blocks when ANY resolved address is internal (multi-record rebinding)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ] as never);
    expect(await isBlockedTarget("mixed.example.com")).toBe(true);
  });

  it("allows a hostname resolving only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    expect(await isBlockedTarget("example.com")).toBe(false);
  });

  it("fails closed on DNS errors and empty results", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isBlockedTarget("does-not-resolve.example.com")).toBe(true);
    lookupMock.mockResolvedValue([] as never);
    expect(await isBlockedTarget("empty.example.com")).toBe(true);
  });
});

// Registry sanity: a duplicated or malformed declaration would confuse the
// model's function-calling (or shadow another tool) without any visible
// error at build time.
describe("tool registry", () => {
  it("every tool name is unique", () => {
    const names = ALL_TOOLS.map((t) => t.declaration.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every declaration is well-formed", () => {
    for (const tool of ALL_TOOLS) {
      const { name, description, parameters } = tool.declaration;
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(description.trim().length).toBeGreaterThan(0);
      expect(parameters).toMatchObject({ type: "object" });
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("getToolByName finds registered tools and rejects unknown names", () => {
    const first = ALL_TOOLS[0];
    expect(getToolByName(first.declaration.name)).toBe(first);
    expect(getToolByName("definitely_not_a_tool")).toBeUndefined();
  });
});

// open_document lets the user OPEN an existing generated file. Its three
// branches (none / exactly one / many) drive different UX: one → the app
// opens the preview; many → the model must disambiguate.
describe("open_document tool", () => {
  const tool = getToolByName("open_document")!;

  // Minimal supabase stub: a chained query builder whose terminal awaits
  // resolve to the canned rows, plus maybeSingle for the by-id path.
  function makeCtx(rows: unknown[], single?: unknown) {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order"]) builder[m] = () => builder;
    builder.limit = () => Promise.resolve({ data: rows, error: null });
    builder.maybeSingle = () => Promise.resolve({ data: single ?? null, error: null });
    return {
      supabase: { from: () => builder },
      userId: "u1",
      agentId: "a1",
      runId: "r1",
      apiKey: "k",
      model: "m",
      logEvent: vi.fn(async () => {}),
    } as never;
  }

  it("returns found:0 when nothing matches", async () => {
    const res = await tool.execute({ query: "nieistniejąca" }, makeCtx([]));
    expect(res.found).toBe(0);
    expect(res.open).toBeUndefined();
  });

  it("returns a single open target when exactly one matches", async () => {
    const row = {
      id: "f1",
      filename: "raport.pptx",
      format: "pptx",
      title: "Raport",
      created_at: "x",
    };
    const res = await tool.execute({ query: "raport" }, makeCtx([row]));
    expect(res.found).toBe(1);
    expect(res.open).toEqual({ id: "f1", filename: "raport.pptx" });
  });

  it("returns candidates (no auto-open) when several match", async () => {
    const rows = [
      {
        id: "f1",
        filename: "s26-a.pptx",
        format: "pptx",
        title: "Samsung S26 Ultra: A",
        created_at: "2",
      },
      {
        id: "f2",
        filename: "s26-b.pptx",
        format: "pptx",
        title: "Samsung S26 Ultra: B",
        created_at: "1",
      },
    ];
    // Inflected, word-separated query — the old whole-phrase ILIKE would have
    // matched neither title; per-token ranking finds both via s26/ultra.
    const res = await tool.execute({ query: "samsungu s26 ultra" }, makeCtx(rows));
    expect(res.found).toBe(2);
    expect(res.open).toBeUndefined();
    expect((res.candidates as unknown[]).length).toBe(2);
  });

  it("ranks the best token match first and drops non-matching rows", async () => {
    const rows = [
      { id: "f1", filename: "raport.pdf", format: "pdf", title: "Raport roczny", created_at: "3" },
      {
        id: "f2",
        filename: "s26.pptx",
        format: "pptx",
        title: "Samsung S26 Ultra",
        created_at: "2",
      },
    ];
    // Only the Samsung row shares tokens; the unrelated report is filtered out
    // → exactly one match → auto-open.
    const res = await tool.execute({ query: "samsung s26 ultra" }, makeCtx(rows));
    expect(res.found).toBe(1);
    expect(res.open).toEqual({ id: "f2", filename: "s26.pptx" });
  });

  it("opens directly by file_id (disambiguation follow-up)", async () => {
    const single = { id: "f2", filename: "b.pptx", format: "pptx", title: "B" };
    const res = await tool.execute({ file_id: "f2" }, makeCtx([], single));
    expect(res.found).toBe(1);
    expect(res.open).toEqual({ id: "f2", filename: "b.pptx" });
  });
});

// ---------------------------------------------------------------------------
// A2a — klasa ryzyka i „obca treść” (plan naprawczy, etap 1)
// ---------------------------------------------------------------------------

describe("klasa ryzyka narzędzi", () => {
  it("każde narzędzie z ALL_TOOLS ma klasę read / write / external", () => {
    for (const tool of ALL_TOOLS) {
      expect(["read", "write", "external"], tool.declaration.name).toContain(toolRisk(tool, {}));
    }
  });

  it("akcje z skutkiem poza bazą albo nieodwracalne są external", () => {
    for (const name of ["delete_note", "delete_task", "cancel_standing_order"]) {
      expect(toolRisk(getToolByName(name)!, {}), name).toBe("external");
    }
  });

  it("zapisy własnych danych są write, odczyty read", () => {
    for (const name of [
      "save_note",
      "remember",
      "create_task",
      "update_task",
      "generate_document",
    ]) {
      expect(toolRisk(getToolByName(name)!, {}), name).toBe("write");
    }
    for (const name of ["list_notes", "recall", "web_search", "fetch_url", "read_document"]) {
      expect(toolRisk(getToolByName(name)!, {}), name).toBe("read");
    }
  });

  it("obcą treść wnoszą dokładnie narzędzia z listy planu", () => {
    const untrusted = ALL_TOOLS.filter((t) => bringsUntrustedContent(t, {})).map(
      (t) => t.declaration.name,
    );
    expect(untrusted.sort()).toEqual(
      [
        "fetch_url",
        "read_document",
        "read_generated_file",
        "search_documents",
        "web_search",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// A2d — źródło wpisu w pamięci (plan naprawczy, etap 1)
// ---------------------------------------------------------------------------

describe("remember / recall — pochodzenie wpisu", () => {
  const baseCtx = (db: ToolContext["supabase"], untrustedContent?: boolean): ToolContext => ({
    supabase: db,
    userId: "u1",
    agentId: "a1",
    runId: "r1",
    apiKey: "",
    model: "gemini-2.5-flash",
    logEvent: async () => {},
    untrustedContent,
  });

  async function rememberWith(untrustedContent: boolean | undefined) {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); // bez embeddingu
    const { db, calls } = makeDb((table, ops) =>
      table === "memories" && ops.some((o) => o.method === "insert")
        ? { data: { id: "m1" }, error: null }
        : undefined,
    );
    const res = await getToolByName("remember")!.execute(
      { value: "Właściciel lubi espresso." },
      baseCtx(db, untrustedContent),
    );
    vi.unstubAllGlobals();
    const insert = calls.find((c) => c.ops.some((o) => o.method === "insert"))!;
    return {
      res,
      row: insert.ops.find((o) => o.method === "insert")!.args[0] as Record<string, unknown>,
    };
  }

  it("wpis z tury bez obcej treści ma origin = user", async () => {
    const { res, row } = await rememberWith(false);
    expect(res).toMatchObject({ ok: true, id: "m1" });
    expect(row.origin).toBe("user");
  });

  it("wpis z tury, w której była obca treść, ma origin = tool", async () => {
    const { row } = await rememberWith(true);
    expect(row.origin).toBe("tool");
  });

  it("recall zwraca origin razem z treścią", async () => {
    const { db } = makeDb((table, ops) => {
      if (table !== "memories") return undefined;
      if (ops.some((o) => o.method === "in"))
        return { data: [{ id: "m1", origin: "tool" }], error: null };
      return {
        data: [
          {
            id: "m1",
            key: null,
            value: "Właściciel lubi espresso.",
            tags: [],
            importance: 3,
            updated_at: "2026-11-11",
          },
        ],
        error: null,
      };
    });
    const res = (await getToolByName("recall")!.execute({}, baseCtx(db))) as {
      memories: Array<Record<string, unknown>>;
    };
    expect(res.memories[0]).toMatchObject({ value: "Właściciel lubi espresso.", origin: "tool" });
  });
});

// ---------------------------------------------------------------------------
// A13 — fetch_url: limit czasu i rozmiaru, tylko treść tekstowa
// ---------------------------------------------------------------------------

describe("fetch_url — limity", () => {
  const ctx = (): ToolContext => ({
    supabase: makeDb(() => undefined).db,
    userId: "u1",
    agentId: "a1",
    runId: "r1",
    apiKey: "",
    model: "m",
    logEvent: async () => {},
  });
  // Adres IP z puli publicznej — strażnik SSRF przepuszcza go bez DNS.
  const URL_PUBLIC = "http://93.184.216.34/strona";

  function streamResponse(contentType: string | null, body: ReadableStream<Uint8Array>) {
    return new Response(body, {
      status: 200,
      headers: contentType ? { "content-type": contentType } : {},
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("odrzuca treść nietekstową bez czytania jej", async () => {
    // highWaterMark 0: strumień nie napełnia bufora sam, więc `pull` = próba czytania.
    const pull = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamResponse("application/pdf", new ReadableStream({ pull }, { highWaterMark: 0 })),
        ),
    );
    const res = await getToolByName("fetch_url")!.execute({ url: URL_PUBLIC }, ctx());
    expect(res).toMatchObject({
      error: "unsupported_content_type",
      content_type: "application/pdf",
    });
    expect(pull).not.toHaveBeenCalled();
  });

  it("czyta strumieniem i przerywa po limicie bajtów", async () => {
    let served = 0;
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        served += chunk.length;
        c.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("text/plain", endless)));
    const res = await getToolByName("fetch_url")!.execute({ url: URL_PUBLIC }, ctx());
    expect(res).toMatchObject({ status: 200, truncated: true });
    expect(served).toBeLessThanOrEqual(FETCH_MAX_BYTES + 2 * chunk.length);
  });

  it("jeden limit czasu obejmuje także czytanie treści", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("<p>początek</p>"));
        // potem nic — serwer wisi
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("text/html", stalled)));
    const pending = getToolByName("fetch_url")!.execute({ url: URL_PUBLIC }, ctx());
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 10);
    expect(await pending).toEqual({ error: "timeout" });
  });

  it("zwykła strona HTML: tekst bez znaczników", async () => {
    const html = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode("<html><script>x()</script><p>Cześć <b>świat</b></p></html>"),
        );
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamResponse("text/html; charset=utf-8", html)),
    );
    const res = await getToolByName("fetch_url")!.execute({ url: URL_PUBLIC }, ctx());
    expect(res).toMatchObject({ status: 200, text: "Cześć świat", truncated: false });
  });
});

describe("A21 — ważność linku do wygenerowanego pliku", () => {
  it("podpisany link żyje 24 h", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(24 * 3600);
  });
});

// ---------------------------------------------------------------------------
// Etap 2 — narzędzia zapisują zużycie modeli do księgi llm_usage
// ---------------------------------------------------------------------------

describe("narzędzia — księga llm_usage", () => {
  const ledgerRows = (calls: ReturnType<typeof makeDb>["calls"]) =>
    calls
      .filter((c) => c.table === "llm_usage")
      .map((c) => c.ops.find((o) => o.method === "insert")!.args[0] as Record<string, unknown>);

  afterEach(() => vi.unstubAllGlobals());

  it("web_search: klucz w nagłówku, wiersz w księdze z run_id i celem web_search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Odpowiedź." }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = makeDb(() => undefined);
    const res = await getToolByName("web_search")!.execute(
      { query: "pogoda" },
      {
        supabase: db,
        userId: "u1",
        agentId: "a1",
        runId: "r1",
        apiKey: "tajny",
        model: "gemini-2.5-flash",
        logEvent: async () => {},
      },
    );
    expect(res).toMatchObject({ answer: "Odpowiedź." });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tajny");
    expect(ledgerRows(calls)).toEqual([
      expect.objectContaining({
        module: "agents",
        purpose: "web_search",
        run_id: "r1",
        tokens_input: 50,
        tokens_output: 20,
      }),
    ]);
  });

  it("remember: embedding zapisany w księdze jako cel embed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: { values: new Array(768).fill(0.1) } }),
        text: async () => "",
      }),
    );
    const { db, calls } = makeDb((table, ops) =>
      table === "memories" && ops.some((o) => o.method === "insert")
        ? { data: { id: "m1" }, error: null }
        : undefined,
    );
    await getToolByName("remember")!.execute(
      { value: "Lubię espresso." },
      {
        supabase: db,
        userId: "u1",
        agentId: "a1",
        runId: "r1",
        apiKey: "k",
        model: "gemini-2.5-flash",
        logEvent: async () => {},
      },
    );
    expect(ledgerRows(calls)).toEqual([
      expect.objectContaining({
        module: "agents",
        purpose: "embed",
        model: "gemini-embedding-001",
        run_id: "r1",
        estimated: true,
      }),
    ]);
  });
});
