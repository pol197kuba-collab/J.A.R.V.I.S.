// Vision AR (S4.3) — live mode: one small frame → labelled boxes of the
// objects in it (Gemini object detection, JSON mode). The client sends a
// frame at most every 3 s, only when the picture changed, and stops after
// 60 s (src/lib/vision/live.ts), so this stays a handful of cheap calls.
// Only failures are logged — a log row per frame would flood system_events.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import type { Json } from "@/integrations/supabase/types";
import { MAX_DETECTIONS, normalizeDetections, type Detection } from "./live";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DetectInput = z.object({
  imageBase64: z.string().min(100).max(800_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

export type LiveDetections = { objects: Detection[]; latencyMs: number };

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      label: { type: "STRING", description: "Krótka nazwa po polsku, 1–3 słowa" },
      box_2d: {
        type: "ARRAY",
        items: { type: "INTEGER" },
        description: "[ymin, xmin, ymax, xmax] w skali 0–1000",
      },
    },
    required: ["label", "box_2d"],
  },
};

export const detectObjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetectInput.parse(input))
  .handler(async ({ data, context }): Promise<LiveDetections> => {
    const { supabase, userId } = context;
    const startedAt = Date.now();
    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim();
    if (!apiKey) throw new Error("Brak klucza Gemini. Wpisz go w Settings → AI Core.");

    const fail = async (message: string, meta?: Json): Promise<never> => {
      await supabase.from("system_events").insert({
        owner_id: userId,
        level: "error",
        source: "tool.vision_live",
        message,
        meta: (meta ?? {}) as Json,
      });
      throw new Error("Tryb na żywo: rdzeń AI nie odpowiedział — spróbuj ponownie.");
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text:
                    `Wykrywasz najważniejsze obiekty na klatce z kamery (najwyżej ${MAX_DETECTIONS}). ` +
                    "Dla każdego: krótka nazwa po polsku (1–3 słowa, konkretnie: „kubek”, „laptop”, " +
                    "„pies — spaniel”) i ramka box_2d [ymin, xmin, ymax, xmax] w skali 0–1000. " +
                    "Pomijaj tło (ściana, podłoga, sufit). Zwróć wyłącznie tablicę JSON.",
                },
              ],
            },
            generationConfig: {
              temperature: 0.2,
              thinkingConfig: { thinkingBudget: 0 },
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
            contents: [
              {
                role: "user",
                parts: [{ inlineData: { mimeType: data.mimeType, data: data.imageBase64 } }],
              },
            ],
          }),
        },
      );
    } catch (err) {
      return fail(`live detect failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(`live detect HTTP ${res.status}`, { body: body.slice(0, 300) } as Json);
    }
    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    let raw: unknown = [];
    try {
      raw = JSON.parse(text);
    } catch {
      raw = [];
    }
    return { objects: normalizeDetections(raw), latencyMs: Date.now() - startedAt };
  });
