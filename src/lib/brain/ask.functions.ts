// Mózg 3D — „Skąd J.A.R.V.I.S. to wie”: pytanie z panelu na /mozg.
//
// Własna droga zamiast czatu: czat przy braku klucza na serwerze cicho
// spadał na zapasową kwestię („Zrozumiałem. Czekam na dyspozycje.”) bez
// żadnego wyszukiwania, więc gwiazdy nigdy nie rozbłyskiwały. Tu zawsze
// biegną te same narzędzia co u agenta — `recall` (wspomnienia + notatki)
// i `search_documents` — które zapisują ślad w brain_traces (Realtime
// zapala gwiazdy). Odpowiedź Gemini powstaje wyłącznie z tego, co znalazły;
// bez klucza panel dostaje znalezione źródła i jasny komunikat.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logServerError } from "@/lib/system/logServerError";
import type { Json } from "@/integrations/supabase/types";
import type { TraceItem } from "./trace";

const ANSWER_MODEL = "gemini-flash-latest";
const ANSWER_TIMEOUT_MS = 20_000;

export type BrainAnswer = {
  /** ok = odpowiedź z modelu; no_key = brak klucza Gemini; model_error = model nie odpowiedział. */
  status: "ok" | "no_key" | "model_error";
  answer: string | null;
  /** Znalezione gwiazdy — panel podświetla je od razu, bez czekania na Realtime. */
  items: TraceItem[];
};

type RecallResult = {
  memories?: { id: string; key: string | null; value: string; similarity?: number }[];
  notes?: { id: string; title: string; body: string; similarity?: number }[];
  error?: string;
};
type DocsResult = {
  chunks?: { document_id: string; filename: string; content: string; similarity?: number }[];
  error?: string;
};

export const askBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BrainAnswer> => {
    const { supabase, userId } = context;
    const question = data.question.trim();
    const { getToolByName } = await import("@/lib/agents/tools.server");

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim() ?? "";

    const ctx = {
      supabase,
      userId,
      agentId: "",
      runId: "",
      apiKey,
      model: ANSWER_MODEL,
      logEvent: async (
        level: "info" | "warn" | "error",
        source: string,
        message: string,
        meta?: Json,
      ) => {
        if (level === "info") return;
        await supabase.from("system_events").insert({
          owner_id: userId,
          level,
          source: `brain.ask.${source}`,
          message,
          meta: meta ?? null,
        });
      },
    };

    let recall: RecallResult = {};
    let docs: DocsResult = {};
    try {
      [recall, docs] = (await Promise.all([
        getToolByName("recall")!.execute({ query: question, limit: 6 }, ctx),
        getToolByName("search_documents")!.execute({ query: question, limit: 4 }, ctx),
      ])) as [RecallResult, DocsResult];
    } catch (err) {
      await logServerError(supabase, userId, "brain.ask", err);
      throw err instanceof Error ? err : new Error(String(err));
    }

    const memories = recall.memories ?? [];
    const notes = recall.notes ?? [];
    const chunks = docs.chunks ?? [];
    const items: TraceItem[] = [
      ...memories.map((m) => ({ type: "memory" as const, id: m.id, score: m.similarity ?? null })),
      ...notes.map((n) => ({ type: "note" as const, id: n.id, score: n.similarity ?? null })),
      ...chunks.map((c) => ({
        type: "document" as const,
        id: c.document_id,
        score: c.similarity ?? null,
      })),
    ];

    if (!apiKey) return { status: "no_key", answer: null, items };

    const sources = [
      ...memories.map((m) => `[wspomnienie] ${m.key ? `${m.key}: ` : ""}${m.value}`),
      ...notes.map((n) => `[notatka „${n.title}”] ${n.body}`),
      ...chunks.map((c) => `[dokument ${c.filename}] ${c.content.slice(0, 800)}`),
    ];
    const prompt = [
      "Jesteś J.A.R.V.I.S. Odpowiedz po polsku, krótko (2–4 zdania), na pytanie użytkownika",
      "WYŁĄCZNIE na podstawie poniższych fragmentów jego wiedzy. Powiedz, z którego źródła",
      "(wspomnienie / notatka z tytułem / dokument) to wiesz. Jeśli fragmenty nie odpowiadają",
      "na pytanie, powiedz wprost, że w zapisanej wiedzy tego nie ma — nie zgaduj.",
      "",
      `Pytanie: ${question}`,
      "",
      "Fragmenty:",
      sources.length > 0 ? sources.join("\n") : "(brak)",
    ].join("\n");

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ANSWER_TIMEOUT_MS);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${ANSWER_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
          }),
        },
      ).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const answer = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!answer) throw new Error("Gemini: pusta odpowiedź");
      return { status: "ok", answer, items };
    } catch (err) {
      await logServerError(supabase, userId, "brain.ask", err);
      return { status: "model_error", answer: null, items };
    }
  });
