// Vision analysis — server function behind the Vision page's SCAN button.
//
// Receives a single downscaled JPEG frame from the client, sends it to
// Gemini (multimodal generateContent) using the user's own API key from
// user_secrets, and returns a short in-persona description of what the
// camera sees. Runs server-side so the key never reaches the browser,
// mirroring the Agent Runtime pattern in runtime.server.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import type { Json } from "@/integrations/supabase/types";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ~1.5MB of raw base64 ≈ a 1024px JPEG with plenty of headroom. The client
// downscales before sending; this cap is the server-side backstop so a
// misbehaving client can't post arbitrarily large payloads.
const MAX_BASE64_LENGTH = 2_000_000;

const AnalyzeScanInput = z.object({
  /** Raw base64 payload WITHOUT the data: URL prefix. */
  imageBase64: z.string().min(100).max(MAX_BASE64_LENGTH),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  /** BCP-47-ish tag from navigator.language; drives the reply language. */
  language: z.string().max(20).optional(),
});

const scanSystemPrompt = (language: string) =>
  `You are J.A.R.V.I.S., Tony-Stark-style AI butler analysing a live camera frame ` +
  `for your principal, Mr. Sławiński. Priorities, in order: ` +
  `(1) Identify the PRIMARY subject of the frame as precisely as you can — for an ` +
  `animal give the breed/species, for a device the type and likely brand/model, for ` +
  `a plant the species, for a book/product the title/name, for a person a brief ` +
  `appearance description (never a name). Lead with that identification. ` +
  `(2) Add 2-3 short, genuinely interesting facts or expert observations about the ` +
  `identified subject (e.g. breed traits and trivia for a dog, specs for a device). ` +
  `(3) Mention the surrounding scene only if something is notable — never pad with ` +
  `vague filler like "a room with dim lighting". ` +
  `If unsure of an identification, give your best guess with a caveat. ` +
  `Max ~120 words, plain text only — no markdown, no lists, no preamble. ` +
  `Answer in the language "${language}" with a refined, slightly witty butler tone.`;

export type ScanAnalysis = {
  description: string;
  model: string;
  latencyMs: number;
};

export const analyzeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeScanInput.parse(input))
  .handler(async ({ data, context }): Promise<ScanAnalysis> => {
    const { supabase, userId } = context;
    const startedAt = Date.now();

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim();
    if (!apiKey) {
      throw new Error(
        "Brak klucza Gemini. Wpisz go w Settings → AI Core, aby włączyć analizę obrazu.",
      );
    }

    const logEvent = async (level: "info" | "warn" | "error", message: string, meta?: Json) => {
      await supabase.from("system_events").insert({
        owner_id: userId,
        level,
        source: "tool.vision_scan",
        message,
        meta: (meta ?? {}) as Json,
      });
    };

    const model = DEFAULT_GEMINI_MODEL;
    const language = data.language?.trim() || "pl-PL";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: scanSystemPrompt(language) }] },
            generationConfig: { temperature: 0.5, maxOutputTokens: 600 },
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: data.mimeType, data: data.imageBase64 } },
                  { text: "Analyse this frame from my optical sensor." },
                ],
              },
            ],
          }),
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logEvent("error", `scan failed: ${msg}`);
      throw new Error("Analiza obrazu nie powiodła się — problem z połączeniem do rdzenia AI.");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await logEvent("error", `scan HTTP ${res.status}`, { body: body.slice(0, 300) } as Json);
      throw new Error(`Analiza obrazu odrzucona przez rdzeń AI (HTTP ${res.status}).`);
    }

    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const description = (payload.candidates?.[0]?.content?.parts ?? [])
      .flatMap((p) => (p.text ? [p.text] : []))
      .join("")
      .trim();

    if (!description) {
      await logEvent("warn", "scan returned empty description");
      throw new Error("Rdzeń AI nie zwrócił opisu — spróbuj ponownie.");
    }

    const latencyMs = Date.now() - startedAt;
    await logEvent("info", `scan analysed · ${latencyMs}ms`, {
      latency_ms: latencyMs,
      model,
      description_preview: description.slice(0, 140),
    } as Json);

    return { description, model, latencyMs };
  });
