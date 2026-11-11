// Klient Gemini (generateContent / embedContent) — jedyne miejsce w aplikacji,
// które zna adres API Gemini (poza testem klucza i listą modeli).
//
// Klucz idzie w nagłówku `x-goog-api-key` (A18; wcześniej w adresie URL, więc
// lądował w logach proxy i w komunikatach błędów). Zweryfikowane w
// dokumentacji Gemini 2026-11-11.
import { recordLlmUsage, type LedgerContext } from "./ledger";
import { requestJson, type JsonRequest } from "./http";
import {
  estimateTokens,
  geminiUsage,
  ZERO_USAGE,
  type GeminiUsageMetadata,
  type LlmUsage,
} from "./usage";

export const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiCall = {
  apiKey: string;
  model: string;
  /** Treść żądania generateContent w formacie API (systemInstruction, contents…). */
  body: Record<string, unknown> | string;
  timeoutMs: number;
  retries?: number;
  backoffMs?: number;
  onRetry?: JsonRequest["onRetry"];
  ledger?: LedgerContext;
};

export type GeminiResult<T> =
  | { ok: true; data: T; usage: LlmUsage; costUsd: number | null }
  | {
      ok: false;
      status: number | null;
      bodyText: string;
      timedOut: boolean;
      message: string;
      /** Surowy komunikat błędu sieci (status null). */
      error?: string;
    };

const failMessage = (status: number | null, bodyText: string, timedOut: boolean, error?: string) =>
  timedOut
    ? "Gemini: przekroczony czas"
    : status === null
      ? `Gemini network: ${error ?? "?"}`
      : `Gemini HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`;

/** Jedno wywołanie generateContent z zapisem zużycia do księgi. */
export async function callGemini<T extends { usageMetadata?: GeminiUsageMetadata }>(
  call: GeminiCall,
): Promise<GeminiResult<T>> {
  const res = await requestJson<T>({
    url: `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(call.model)}:generateContent`,
    headers: { "x-goog-api-key": call.apiKey },
    body: call.body,
    timeoutMs: call.timeoutMs,
    retries: call.retries,
    backoffMs: call.backoffMs,
    onRetry: call.onRetry,
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      bodyText: res.bodyText,
      timedOut: res.timedOut,
      message: failMessage(res.status, res.bodyText, res.timedOut, res.error),
      error: res.error,
    };
  }
  const usage = geminiUsage(res.data?.usageMetadata);
  const costUsd = await recordLlmUsage(call.ledger, {
    provider: "gemini",
    model: call.model,
    usage,
  });
  return { ok: true, data: res.data, usage, costUsd };
}

export type GeminiEmbedCall = {
  apiKey: string;
  model: string;
  text: string;
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
  outputDimensionality?: number;
  timeoutMs: number;
  ledger?: LedgerContext;
};

/** Embedding jednego tekstu; null przy każdej porażce (wywołujący mają zapas). */
export async function embedWithGemini(call: GeminiEmbedCall): Promise<number[] | null> {
  const res = await requestJson<{
    embedding?: { values?: number[] };
    usageMetadata?: GeminiUsageMetadata;
  }>({
    url: `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(call.model)}:embedContent`,
    headers: { "x-goog-api-key": call.apiKey },
    body: {
      model: `models/${call.model}`,
      content: { parts: [{ text: call.text }] },
      taskType: call.taskType,
      ...(call.outputDimensionality ? { outputDimensionality: call.outputDimensionality } : {}),
    },
    timeoutMs: call.timeoutMs,
    retries: 0,
  });
  if (!res.ok) return null;
  const values = res.data?.embedding?.values;
  // embedContent zwykle nie podaje zużycia — wtedy szacunek z długości tekstu.
  const reported = res.data?.usageMetadata;
  const usage: LlmUsage = reported
    ? geminiUsage(reported)
    : { ...ZERO_USAGE, input: estimateTokens(call.text) };
  await recordLlmUsage(call.ledger, {
    provider: "gemini",
    model: call.model,
    usage,
    estimated: !reported,
  });
  return Array.isArray(values) && values.length > 0 ? values : null;
}
