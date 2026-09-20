// Anthropic adapter — translates the canonical Gemini-shaped conversation
// (see ./types.ts) into an Anthropic Messages API request, and translates the
// response back. Same contract and same boundary as providers/groq.ts, so the
// tool-calling loop in runtime.server.ts never learns which provider served a
// given turn and `contents` stays in one shape for the whole run.
//
// Raw HTTP instead of @anthropic-ai/sdk on purpose: this file runs inside a
// TanStack server function next to the existing Gemini/Groq fetch calls, the
// request shape used here is small and stable, and adding the SDK would pull a
// dependency into a bundle that currently has none for either other provider.
//
// Deliberately NOT routed here: web_search grounding (Gemini's native Google
// Search) and memory embeddings (gemini-embedding-001). Those are
// Gemini-specific capabilities, not conversational turns.
import type { GeminiContent, ModelTurnResult, ToolDeclaration } from "./types";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Sampling parameters were removed from the Claude 4.6+ reasoning models —
// sending `temperature` to Opus 5 / Sonnet 5 is a hard 400, not a warning.
// Haiku 4.5 and older models still accept it. Matching on the family name
// rather than an allowlist of exact IDs means a future dated snapshot of the
// same family keeps behaving correctly.
const TEMPERATURE_MODEL_RE = /haiku|claude-3|sonnet-4-5|opus-4-5/i;

export const supportsTemperature = (modelId: string): boolean => TEMPERATURE_MODEL_RE.test(modelId);

type AnthropicToolUse = { type: "tool_use"; id: string; name: string; input: unknown };
type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicThinkingBlock = { type: "thinking" | "redacted_thinking" };
type AnthropicResponseBlock = AnthropicToolUse | AnthropicTextBlock | AnthropicThinkingBlock;

type AnthropicRequestBlock =
  | AnthropicTextBlock
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicRequestBlock[] };

/**
 * Gemini's `contents` pairs each `model` turn holding functionCalls with the
 * immediately-following `function` turn holding the matching functionResponses,
 * in the same order — exactly how runtime.server.ts builds it. Anthropic needs
 * an explicit `tool_use_id` linking a tool_result back to its tool_use, and
 * Gemini has no such id, so we synthesize one and lean on that pairing
 * invariant to reconnect them. Same approach as the Groq adapter.
 *
 * Shape differences Anthropic enforces that Gemini does not:
 *   * tool_result blocks belong to a `user` message, not a third role.
 *   * a message's content array may not be empty.
 *   * the first message must be `user`.
 */
export function toAnthropicMessages(contents: GeminiContent[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  let counter = 0;
  let pendingIds: string[] = [];

  for (const c of contents) {
    if (c.role === "user") {
      const text = c.parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("");
      if (text) messages.push({ role: "user", content: [{ type: "text", text }] });
      continue;
    }

    if (c.role === "model") {
      const text = c.parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("");
      const calls = c.parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
      const blocks: AnthropicRequestBlock[] = [];
      if (text) blocks.push({ type: "text", text });
      pendingIds = calls.map(() => `toolu_${counter++}`);
      calls.forEach((fc, i) => {
        blocks.push({
          type: "tool_use",
          id: pendingIds[i],
          name: fc.name,
          input: fc.args ?? {},
        });
      });
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      continue;
    }

    // c.role === "function" — tool results ride back on a user message.
    const responses = c.parts.flatMap((p) => ("functionResponse" in p ? [p.functionResponse] : []));
    const blocks: AnthropicRequestBlock[] = responses.map((r, i) => ({
      type: "tool_result",
      tool_use_id: pendingIds[i] ?? `toolu_unknown_${i}`,
      content: JSON.stringify(r.response ?? {}),
    }));
    if (blocks.length > 0) messages.push({ role: "user", content: blocks });
  }

  // An assistant-first history would be rejected outright. It shouldn't happen
  // with how runtime.server.ts builds `contents`, but a malformed run is worth
  // a repaired request rather than an opaque 400.
  if (messages.length > 0 && messages[0].role === "assistant") {
    messages.unshift({ role: "user", content: [{ type: "text", text: "(kontynuuj)" }] });
  }
  return messages;
}

function toAnthropicTools(decls: ToolDeclaration[]) {
  // Tool declarations in this codebase are already plain JSON Schema
  // (lowercase "object"/"string" types), which is what input_schema expects —
  // no conversion needed, unlike Gemini's uppercase-type dialect.
  return decls.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
  }));
}

export type CallAnthropicOptions = {
  apiKey: string;
  /** Bare Anthropic model id, WITHOUT the "anthropic:" routing prefix. */
  model: string;
  systemPrompt: string;
  contents: GeminiContent[];
  toolDeclarations?: ToolDeclaration[];
  /** Force one specific tool by name (F.O.R.G.E.'s generate_document pin). */
  forceToolName?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export async function callAnthropic(opts: CallAnthropicOptions): Promise<ModelTurnResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const tools = opts.toolDeclarations?.length
      ? toAnthropicTools(opts.toolDeclarations)
      : undefined;

    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: opts.model,
        // max_tokens is required by the Messages API. The per-agent budget is
        // clamped to 8192 upstream, which is well inside every current model's
        // output cap.
        max_tokens: opts.maxOutputTokens ?? 4096,
        system: opts.systemPrompt,
        messages: toAnthropicMessages(opts.contents),
        ...(opts.temperature !== undefined && supportsTemperature(opts.model)
          ? { temperature: opts.temperature }
          : {}),
        ...(tools
          ? {
              tools,
              ...(opts.forceToolName
                ? { tool_choice: { type: "tool", name: opts.forceToolName } }
                : {}),
            }
          : {}),
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content?: AnthropicResponseBlock[];
      stop_reason?: string;
      stop_details?: { category?: string | null; explanation?: string | null };
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const blocks = data.content ?? [];
    const functionCalls = blocks.flatMap((b) =>
      b.type === "tool_use"
        ? [
            {
              name: b.name,
              // Claude may vary JSON escaping inside tool inputs; the API
              // already hands it back parsed, but a non-object (or null) input
              // would break every downstream `args.foo` read.
              args:
                b.input && typeof b.input === "object" && !Array.isArray(b.input)
                  ? (b.input as Record<string, unknown>)
                  : {},
            },
          ]
        : [],
    );
    const text = blocks
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();

    // A safety decline comes back HTTP 200 with no usable content — surfacing
    // it as an empty turn would read as "the model chose to stop". Make it an
    // error so the run's existing failover + logging path handles it like any
    // other provider failure.
    if (data.stop_reason === "refusal" && functionCalls.length === 0 && !text) {
      const category = data.stop_details?.category ?? "unknown";
      throw new Error(`Anthropic refusal (${category})`);
    }

    return {
      text,
      functionCalls,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
