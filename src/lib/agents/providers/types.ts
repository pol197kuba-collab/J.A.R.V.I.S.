// Shared conversation-turn shape for the Orchestrator's model loop.
//
// Gemini's request/response format is the canonical in-memory representation
// (runtime.server.ts builds and mutates `contents` in this shape across the
// whole tool-calling loop). Every other provider adapter translates into and
// out of this shape at its own boundary, so the loop itself never needs to
// know which provider actually served a given turn.

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = { role: "user" | "model" | "function"; parts: GeminiPart[] };

export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelTurnResult = {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tokensIn: number;
  tokensOut: number;
};
