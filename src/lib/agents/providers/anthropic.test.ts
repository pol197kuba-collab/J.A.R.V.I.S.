// Adapter-boundary tests: the only thing this file owns is the translation
// between the canonical Gemini-shaped conversation and Anthropic's Messages
// API. Everything asserted here is a shape the API rejects (or silently
// mis-handles) when it's wrong — a 400 that would only surface live.
import { describe, expect, it, vi, afterEach } from "vitest";
import { callAnthropic, supportsTemperature, toAnthropicMessages } from "./anthropic";
import type { GeminiContent } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("toAnthropicMessages", () => {
  it("reconnects each tool result to the tool call it answers", () => {
    const contents: GeminiContent[] = [
      { role: "user", parts: [{ text: "sprawdź pogodę i kurs" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "weather", args: { city: "Warszawa" } } },
          { functionCall: { name: "fx", args: { pair: "USDPLN" } } },
        ],
      },
      {
        role: "function",
        parts: [
          { functionResponse: { name: "weather", response: { temp: 12 } } },
          { functionResponse: { name: "fx", response: { rate: 4.1 } } },
        ],
      },
    ];

    const messages = toAnthropicMessages(contents);

    expect(messages).toHaveLength(3);
    const assistant = messages[1];
    expect(assistant.role).toBe("assistant");
    const toolUseIds = assistant.content.map((b) => (b.type === "tool_use" ? b.id : null));
    // Tool results ride on a USER message in Anthropic's shape, not a third
    // role — and each one must carry the id of its matching call, in order.
    const results = messages[2];
    expect(results.role).toBe("user");
    const resultIds = results.content.map((b) => (b.type === "tool_result" ? b.tool_use_id : null));
    expect(resultIds).toEqual(toolUseIds);
  });

  it("keeps assistant text alongside its tool calls", () => {
    const messages = toAnthropicMessages([
      { role: "user", parts: [{ text: "zrób prezentację" }] },
      {
        role: "model",
        parts: [
          { text: "Już się robi." },
          { functionCall: { name: "generate_document", args: {} } },
        ],
      },
    ]);
    expect(messages[1].content.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });

  it("never emits an empty content array", () => {
    const messages = toAnthropicMessages([
      { role: "user", parts: [{ text: "" }] },
      { role: "model", parts: [] },
      { role: "user", parts: [{ text: "cześć" }] },
    ]);
    expect(messages.every((m) => m.content.length > 0)).toBe(true);
  });

  it("repairs a history that would start with an assistant turn", () => {
    const messages = toAnthropicMessages([{ role: "model", parts: [{ text: "halo" }] }]);
    expect(messages[0].role).toBe("user");
  });
});

describe("supportsTemperature", () => {
  it("omits sampling for the reasoning models that reject it", () => {
    // Opus 5 / Sonnet 5 hard-400 on `temperature` — this is the guard that
    // keeps a per-agent temperature slider from breaking every Claude run.
    expect(supportsTemperature("claude-opus-5")).toBe(false);
    expect(supportsTemperature("claude-sonnet-5")).toBe(false);
    expect(supportsTemperature("claude-haiku-4-5")).toBe(true);
  });
});

describe("callAnthropic", () => {
  const base = {
    apiKey: "sk-test",
    systemPrompt: "Jesteś JARVIS.",
    contents: [{ role: "user" as const, parts: [{ text: "cześć" }] }],
  };

  it("sends no temperature to Opus 5 but does to Haiku", async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    await callAnthropic({ ...base, model: "claude-opus-5", temperature: 0.8 });
    const opusBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(opusBody.temperature).toBeUndefined();
    expect(opusBody.system).toBe("Jesteś JARVIS.");

    await callAnthropic({ ...base, model: "claude-haiku-4-5", temperature: 0.8 });
    const haikuBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(haikuBody.temperature).toBe(0.8);
  });

  it("maps tool_use blocks onto the canonical functionCalls shape", async () => {
    mockFetchOnce({
      content: [
        { type: "thinking" },
        { type: "tool_use", id: "toolu_x", name: "save_note", input: { title: "t" } },
      ],
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    const result = await callAnthropic({ ...base, model: "claude-opus-5" });

    expect(result.functionCalls).toEqual([{ name: "save_note", args: { title: "t" } }]);
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(4);
  });

  it("pins the forced tool when the producer requires it", async () => {
    const fetchMock = mockFetchOnce({ content: [], usage: {} });
    await callAnthropic({
      ...base,
      model: "claude-sonnet-5",
      toolDeclarations: [
        { name: "generate_document", description: "d", parameters: { type: "object" } },
      ],
      forceToolName: "generate_document",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "generate_document" });
    expect(body.tools[0].input_schema).toEqual({ type: "object" });
  });

  it("turns a safety decline into an error instead of a silent empty turn", async () => {
    mockFetchOnce({
      content: [],
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      usage: {},
    });
    await expect(callAnthropic({ ...base, model: "claude-opus-5" })).rejects.toThrow(/refusal/i);
  });

  it("surfaces an HTTP failure so the run's Groq failover can take over", async () => {
    mockFetchOnce({ error: { message: "overloaded" } }, false, 529);
    await expect(callAnthropic({ ...base, model: "claude-opus-5" })).rejects.toThrow(
      /Anthropic HTTP 529/,
    );
  });
});
