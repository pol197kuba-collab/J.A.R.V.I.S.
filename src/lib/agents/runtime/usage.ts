// Zużycie runu: suma wywołań, każde wycenione po SWOIM modelu (A20), z tokenami
// myślenia (A11). Trzymane w RunState poza `try`, żeby run zakończony błędem
// też zapisał to, co zużył do chwili awarii (A4).
import { addUsage, type LlmUsage } from "@/lib/ai/llm/usage";
import type { RunState } from "./types";

export function meterUsage(state: RunState, usage: LlmUsage, costUsd: number | null): void {
  state.usage = addUsage(state.usage, usage);
  if (costUsd === null) state.unpriced = true;
  else state.costUsd += costUsd;
}

/** NULL = któreś wywołanie spoza cennika („nie wiem”), nie „za darmo”. */
export const runCost = (state: RunState): number | null =>
  state.unpriced ? null : Math.round(state.costUsd * 1_000_000) / 1_000_000;

export const runUsageColumns = (state: RunState) => ({
  tokens_input: state.usage.input || null,
  tokens_output: state.usage.output + state.usage.thinking || null,
  cache_read_tokens: state.usage.cacheRead || null,
  cache_write_tokens: state.usage.cacheWrite || null,
  cost_usd: runCost(state),
});
