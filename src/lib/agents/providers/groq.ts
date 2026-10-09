// Groq adapter — translates the canonical Gemini-shaped conversation
// (see ./types.ts) into Groq's OpenAI-compatible chat completions request,
// and translates the response back. Used for two things only:
//   1. The perform_ui_action classifier fallback pass (free, instant,
//      replaces a redundant paid Gemini call on every turn that doesn't
//      already call a UI action).
//   2. Emergency failover for the main turn when Gemini errors out.
// Never used for tool *execution* (web_search's Google Search grounding and
// the memory embeddings stay Gemini-only — those are Gemini-specific
// capabilities, not something Groq can substitute).
import type { GeminiContent, ModelTurnResult, ToolDeclaration } from "./types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// Gemini's `contents` array pairs each `model` turn containing functionCalls
// with the immediately-following `function` turn containing the matching
// functionResponses, in the same order (that's exactly how runtime.server.ts
// builds it: contents.push({role:"model", parts: functionCalls...}) then
// contents.push({role:"function", parts: responseParts}) in lockstep). OpenAI
// tool messages need an explicit id linking a `tool` message back to its
// `assistant` tool_call — Gemini has no such id, so we synthesize one here
// and rely on that pairing invariant to reconnect them correctly.
function toOpenAiMessages(systemPrompt: string, contents: GeminiContent[]): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: "system", content: systemPrompt }];
  let counter = 0;
  let pendingIds: string[] = [];
  for (const c of contents) {
    if (c.role === "user") {
      const text = c.parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("");
      messages.push({ role: "user", content: text });
      continue;
    }
    if (c.role === "model") {
      const text = c.parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("");
      const calls = c.parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
      if (calls.length === 0) {
        messages.push({ role: "assistant", content: text });
        continue;
      }
      pendingIds = calls.map(() => `call_${counter++}`);
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((fc, i) => ({
          id: pendingIds[i],
          type: "function",
          function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) },
        })),
      });
      continue;
    }
    // c.role === "function"
    const responses = c.parts.flatMap((p) => ("functionResponse" in p ? [p.functionResponse] : []));
    responses.forEach((r, i) => {
      messages.push({
        role: "tool",
        tool_call_id: pendingIds[i] ?? `call_unknown_${i}`,
        content: JSON.stringify(r.response ?? {}),
      });
    });
  }
  return messages;
}

function toOpenAiTools(decls: ToolDeclaration[]) {
  return decls.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export type CallGroqOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  contents: GeminiContent[];
  toolDeclarations?: ToolDeclaration[];
  /** Force one specific tool by name (used by the UI-action classifier). */
  forceToolName?: string;
  /** Force SOME tool call without pinning the name — used when the classifier
   *  is choosing between two or more tools (e.g. UI action vs. queue_document_job).
   *  Ignored when forceToolName is set. Without either, tool_choice is "auto",
   *  which lets the model reply with plain text instead of calling anything —
   *  wrong for a classifier pass that must always produce a decision. */
  forceAnyTool?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

// ── self-healing model choice ──────────────────────────────────────────────
//
// Groq retires models without notice. Live failure (2026-10-09): every
// classifier pass 404'd with `llama-3.1-8b-instant` "does not exist or you do
// not have access to it", silently pushing every turn onto the paid Gemini
// classifier path. Instead of hard-coding the next model name (which will be
// retired too), a model_not_found asks Groq which models this key can use and
// picks a stand-in, remembered for the life of the server process.

const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
const substitutes = new Map<string, string>();
const NOT_A_CHAT_MODEL = /whisper|guard|tts|playai|vision|compound|embed|orpheus/i;

/** Best available stand-in for a retired chat model — small/fast first. */
export function chooseGroqModel(available: readonly string[], wanted: string): string | null {
  const chat = available.filter((id) => !NOT_A_CHAT_MODEL.test(id));
  if (chat.includes(wanted)) return wanted;
  const prefs = [
    /instant/i,
    /llama.*8b/i,
    /gpt-oss-20b/i,
    /llama/i,
    /gpt-oss/i,
    /qwen|gemma|mistral/i,
  ];
  for (const re of prefs) {
    const hit = chat.find((id) => re.test(id));
    if (hit) return hit;
  }
  return chat[0] ?? null;
}

const isModelGone = (msg: string) => /model_not_found|does not exist|decommissioned/i.test(msg);

async function availableGroqModels(apiKey: string): Promise<string[]> {
  const res = await fetch(GROQ_MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id?: string; active?: boolean }> };
  return (data.data ?? []).filter((m) => m.id && m.active !== false).map((m) => m.id as string);
}

/**
 * One Groq chat turn. If the requested model has been retired, picks an
 * available stand-in (see chooseGroqModel) and retries once.
 */
export async function callGroq(opts: CallGroqOptions): Promise<ModelTurnResult> {
  const model = substitutes.get(opts.model) ?? opts.model;
  try {
    return await callGroqOnce({ ...opts, model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isModelGone(msg)) throw err;
    const alt = chooseGroqModel(await availableGroqModels(opts.apiKey).catch(() => []), model);
    if (!alt || alt === model) throw err;
    substitutes.set(opts.model, alt);
    return callGroqOnce({ ...opts, model: alt });
  }
}

async function callGroqOnce(opts: CallGroqOptions): Promise<ModelTurnResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const tools = opts.toolDeclarations?.length ? toOpenAiTools(opts.toolDeclarations) : undefined;
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: toOpenAiMessages(opts.systemPrompt, opts.contents),
        temperature: opts.temperature,
        max_tokens: opts.maxOutputTokens,
        ...(tools
          ? {
              tools,
              tool_choice: opts.forceToolName
                ? { type: "function", function: { name: opts.forceToolName } }
                : opts.forceAnyTool
                  ? "required"
                  : "auto",
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Groq HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data.choices?.[0]?.message;
    const functionCalls = (msg?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      args: safeJsonParse(tc.function.arguments),
    }));
    return {
      text: functionCalls.length > 0 ? "" : (msg?.content ?? "").trim(),
      functionCalls,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
