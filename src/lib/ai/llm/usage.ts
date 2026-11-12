// Zużycie jednego wywołania modelu i jego koszt — wspólny język wszystkich
// dostawców (plan naprawczy, etap 2). Czyste funkcje, bez sieci i bazy.
import { costUsd } from "@/lib/agents/pricing";

export type LlmProvider = "gemini" | "anthropic" | "groq";

export type LlmUsage = {
  /** Tokeny wejścia. U Gemini liczba z promptTokenCount (z tokenami z cache). */
  input: number;
  /** Tokeny odpowiedzi BEZ myślenia. */
  output: number;
  /** Tokeny myślenia (Gemini thoughtsTokenCount) — rozliczane jak wyjście. */
  thinking: number;
  /** Tokeny odczytane z cache dostawcy. */
  cacheRead: number;
  /** Tokeny zapisane do cache (Anthropic) — droższe od zwykłego wejścia. */
  cacheWrite: number;
};

export const ZERO_USAGE: LlmUsage = {
  input: 0,
  output: 0,
  thinking: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    thinking: a.thinking + b.thinking,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};

/**
 * Zużycie z `usageMetadata` Gemini.
 *
 * Zweryfikowane w dokumentacji Gemini 2026-11-11: tokeny myślenia przychodzą
 * w `thoughtsTokenCount` i są rozliczane po stawce wyjściowej (A11 — wcześniej
 * nieliczone). Cache: `cachedContentTokenCount`.
 * ZAŁOŻENIE (niepotwierdzone wprost w dokumentacji): `promptTokenCount`
 * ZAWIERA tokeny z cache. Dlatego koszt Gemini liczymy od pełnego wejścia po
 * pełnej stawce (patrz llmCost) — zawyżenie zamiast zaniżenia budżetu.
 */
export function geminiUsage(meta: GeminiUsageMetadata | undefined | null): LlmUsage {
  return {
    input: n(meta?.promptTokenCount),
    output: n(meta?.candidatesTokenCount),
    thinking: n(meta?.thoughtsTokenCount),
    cacheRead: n(meta?.cachedContentTokenCount),
    cacheWrite: 0,
  };
}

/** Koszt w USD po faktycznym modelu wywołania; null = model spoza cennika. */
export function llmCost(provider: LlmProvider, model: string, usage: LlmUsage): number | null {
  if (provider === "gemini") {
    // Wejście w całości po pełnej stawce (patrz założenie w geminiUsage).
    return costUsd(model, { input: usage.input, output: usage.output + usage.thinking });
  }
  return costUsd(model, {
    input: usage.input,
    output: usage.output + usage.thinking,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  });
}

/** Szacunek tokenów z długości tekstu, gdy dostawca nie podaje zużycia. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
