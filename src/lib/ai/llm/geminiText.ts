// Jednorazowe wywołanie Gemini po sam tekst (bez narzędzi) — dla zadań
// „zinterpretuj dane i oddaj JSON": prognozy rynkowe, klasyfikacja newsów.
//
// DLACZEGO OSOBNY MODUŁ: każdy z tych wywołujących miał własną kopię fetcha
// i każda zapomniała o tym samym — gemini-2.5-flash domyślnie „myśli", a
// tokeny myślenia schodzą z TEGO SAMEGO limitu maxOutputTokens co odpowiedź.
// Przy tablicy JSON dla kilkunastu pozycji odpowiedź była ucinana w połowie,
// parser jej nie przyjmował i moduł po cichu spadał na heurystykę. Tak
// prognozy „ai" przestały powstawać po wyczerpaniu kredytów Anthropic
// (2026-09-25), a newsy rynkowe nigdy nie dostały oceny modelu. Czat i Vision
// miały już tę poprawkę (runtime.server.ts, vision.functions.ts).
//
// Drugi cel: powód porażki. Dotąd każdy błąd kończył się `return null` i
// nikt nie wiedział, czy to klucz, limit, czy ucięta odpowiedź.

import { callGemini } from "./gemini";
import type { LedgerContext } from "./ledger";
import type { GeminiUsageMetadata } from "./usage";

export type GeminiTextRequest = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  /** Gdzie zapisać zużycie (księga llm_usage). */
  ledger?: LedgerContext;
};

export type GeminiTextResult = { ok: true; text: string } | { ok: false; reason: string };

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
};

export async function callGeminiText(req: GeminiTextRequest): Promise<GeminiTextResult> {
  const res = await callGemini<GeminiResponse>({
    apiKey: req.apiKey,
    model: req.model,
    body: {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 8192,
        // Interpretacja podanych liczb nie wymaga łańcucha myśli, a myślenie
        // zjada budżet odpowiedzi (patrz komentarz na górze). Musi być
        // WEWNĄTRZ generationConfig — jako pole najwyższego poziomu Gemini
        // odpowiada 400.
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    timeoutMs: req.timeoutMs,
    ledger: req.ledger,
  });
  if (!res.ok) {
    if (res.timedOut) {
      return {
        ok: false,
        reason: `Gemini: przekroczony czas ${Math.round(req.timeoutMs / 1000)} s`,
      };
    }
    if (res.status === null) return { ok: false, reason: `Gemini: ${res.error ?? "network"}` };
    return {
      ok: false,
      reason: `Gemini HTTP ${res.status}${res.bodyText ? `: ${res.bodyText.slice(0, 200)}` : ""}`,
    };
  }
  const data = res.data;
  const candidate = data.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";
  if (!text) {
    const finish = candidate?.finishReason ?? "?";
    const block = data.promptFeedback?.blockReason ?? "?";
    return {
      ok: false,
      reason: `Gemini: pusta odpowiedź (finishReason=${finish}, blockReason=${block})`,
    };
  }
  if (candidate?.finishReason === "MAX_TOKENS") {
    // Ucięty JSON i tak nie przejdzie parsera — lepiej powiedzieć dlaczego.
    return { ok: false, reason: "Gemini: odpowiedź ucięta (finishReason=MAX_TOKENS)" };
  }
  return { ok: true, text };
}
