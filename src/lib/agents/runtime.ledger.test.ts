import { describe, it, expect, vi, afterEach } from "vitest";
import { runOrchestrator } from "./runtime.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  KEYS_WITH_GROQ,
  finalRunRow,
  json,
  providerFetch,
  groqCall,
  geminiText,
  worldDb,
  type DbCall,
} from "./runtime.testkit";

// Etap 2: każde wywołanie modelu w runie zostawia wiersz w księdze llm_usage,
// a koszt runu to suma kosztów wywołań po ich faktycznych modelach.

afterEach(() => vi.unstubAllGlobals());

const ledgerRows = (calls: DbCall[]) =>
  calls
    .filter((c) => c.table === "llm_usage")
    .map((c) => c.ops.find((o) => o.method === "insert")!.args[0] as Record<string, unknown>);

const geminiWithThinking = (text: string, inTok: number, outTok: number, thoughts: number) =>
  json(200, {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: {
      promptTokenCount: inTok,
      candidatesTokenCount: outTok,
      thoughtsTokenCount: thoughts,
    },
  });

describe("runOrchestrator — księga llm_usage", () => {
  it("tura Gemini: wiersz z runem i tokenami myślenia; myślenie wlicza się do kosztu (A11)", async () => {
    const fetchMock = providerFetch({ gemini: [geminiWithThinking("Gotowe.", 1000, 100, 400)] });
    vi.stubGlobal("fetch", fetchMock);
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(ledgerRows(calls)).toEqual([
      expect.objectContaining({
        owner_id: "u1",
        module: "agents",
        purpose: "turn",
        provider: "gemini",
        model: "gemini-2.5-flash",
        tokens_input: 1000,
        tokens_output: 100,
        tokens_thinking: 400,
        run_id: "run-1",
        cost_usd: 0.00155, // 1000 × 0,3/M + (100 + 400) × 2,5/M
      }),
    ]);
    const row = finalRunRow(calls, "run-1")!;
    expect(row.tokens_output).toBe(500); // odpowiedź + myślenie
    expect(row.cost_usd).toBe(0.00155);

    // A18: klucz nie w adresie.
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("key=");
  });

  it("klasyfikator Groq: osobny wiersz po modelu Groq (A20)", async () => {
    vi.stubGlobal(
      "fetch",
      providerFetch({
        gemini: [geminiText("Hej.", { in: 100, out: 10 })],
        groq: [groqCall("perform_ui_action", { action: "none" })],
      }),
    );
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_WITH_GROQ });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "pokaż zadania",
      history: [],
    });

    const rows = ledgerRows(calls);
    expect(rows.map((r) => [r.provider, r.purpose, r.model])).toEqual([
      ["gemini", "turn", "gemini-2.5-flash"],
      ["groq", "classifier", "llama-3.1-8b-instant"],
    ]);
    expect(rows[1]).toMatchObject({ tokens_input: 40, tokens_output: 5, run_id: "run-1" });
  });

  it("nieudane wywołanie Claude nie zostawia wiersza; tura na Gemini tak", async () => {
    vi.stubGlobal(
      "fetch",
      providerFetch({
        anthropic: [json(400, "credit balance is too low")],
        gemini: [geminiText("Gotowe.", { in: 10, out: 2 })],
      }),
    );
    const { db, calls } = worldDb({
      agents: [{ ...HERALD, model: "anthropic:claude-opus-5" }],
      secrets: { ...KEYS_GEMINI_ONLY, anthropic_api_key: "sk" },
    });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(ledgerRows(calls).map((r) => r.provider)).toEqual(["gemini"]);
  });
});

// Etap 3 (A10): stabilny prefiks promptu — data i godzina poza częścią stałą.
describe("runOrchestrator — stabilny prefiks i cache promptu", () => {
  it("Gemini: data w osobnej, ostatniej części instrukcji systemowej", async () => {
    const { geminiBodies } = await import("./runtime.testkit");
    const fetchMock = providerFetch({ gemini: [geminiText("Hej.")] });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    const parts = (geminiBodies(fetchMock)[0].systemInstruction as { parts: { text: string }[] })
      .parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).not.toContain("AKTUALNA DATA");
    expect(parts[1].text).toContain("AKTUALNA DATA I CZAS");
  });

  it("Claude: stały prompt z cache_control, data w bloku za nim", async () => {
    const fetchMock = providerFetch({
      anthropic: [
        json(200, {
          content: [{ type: "text", text: "Hej." }],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = worldDb({
      agents: [{ ...HERALD, model: "anthropic:claude-opus-5-5" }],
      secrets: { ...KEYS_GEMINI_ONLY, anthropic_api_key: "sk" },
    });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Hej",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].text).not.toContain("AKTUALNA DATA");
    expect(body.system[1].text).toContain("AKTUALNA DATA I CZAS");
    expect(body.system[1].cache_control).toBeUndefined();
  });
});
