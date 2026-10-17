// Vision AR (PLAN.md, S4.1) — structured scans.
//
// extractScan: one frame + a mode → Gemini in JSON mode (the mode's schema)
// → a normalized, editable draft. Nothing is saved here.
// saveScan: the draft the user confirmed (and maybe corrected) → strict zod
// check → photo into the private 'scans' bucket for 30 days → vision_scans.
// Each save also clears this user's photos whose 30 days have passed.
// The Gemini key comes from user_secrets server-side, as in analyzeScan.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import type { Json } from "@/integrations/supabase/types";
import {
  MODE_PROMPT,
  MODE_RESPONSE_SCHEMA,
  PHOTO_RETENTION_DAYS,
  SCAN_SCHEMAS,
  normalizeScan,
  type ScanDraft,
} from "./modes";
import { documentMarkdown, fridgeNote } from "./route";
import { sanitizeFilename } from "@/lib/documents/chunking";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// A 1600px receipt JPEG is ~300–600 kB of base64; this is the backstop.
const MAX_BASE64_LENGTH = 3_000_000;
const BUCKET = "scans";

const StructuredModeSchema = z.enum(["receipt", "odometer", "document", "fridge"]);
const ImageSchema = z.object({
  imageBase64: z.string().min(100).max(MAX_BASE64_LENGTH),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

export type ScanExtraction = ScanDraft & { model: string; latencyMs: number; truncated: boolean };

export const extractScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    ImageSchema.extend({ mode: StructuredModeSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ScanExtraction> => {
    const { supabase, userId } = context;
    const startedAt = Date.now();

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", userId)
      .maybeSingle();
    const apiKey = secret?.gemini_api_key?.trim();
    if (!apiKey) {
      throw new Error("Brak klucza Gemini. Wpisz go w Settings → AI Core, aby włączyć skaner.");
    }

    const logEvent = async (level: "info" | "warn" | "error", message: string, meta?: Json) => {
      await supabase.from("system_events").insert({
        owner_id: userId,
        level,
        source: "tool.vision_extract",
        message,
        meta: (meta ?? {}) as Json,
      });
    };

    const model = DEFAULT_GEMINI_MODEL;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text:
                    "Jesteś precyzyjnym czytnikiem dokumentów J.A.R.V.I.S. Zwracasz wyłącznie JSON " +
                    "zgodny ze schematem. Teksty po polsku. " +
                    MODE_PROMPT[data.mode],
                },
              ],
            },
            generationConfig: {
              temperature: 0.1,
              // Reading, not reasoning — thinking would only eat the budget
              // a long receipt needs (see analyzeScan).
              thinkingConfig: { thinkingBudget: 0 },
              maxOutputTokens: data.mode === "document" ? 8192 : 4096,
              responseMimeType: "application/json",
              responseSchema: MODE_RESPONSE_SCHEMA[data.mode],
            },
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: data.mimeType, data: data.imageBase64 } },
                  { text: "Odczytaj to zdjęcie." },
                ],
              },
            ],
          }),
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logEvent("error", `extract ${data.mode} failed: ${msg}`);
      throw new Error("Odczyt nie powiódł się — problem z połączeniem do rdzenia AI.");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await logEvent("error", `extract ${data.mode} HTTP ${res.status}`, {
        body: body.slice(0, 300),
      } as Json);
      throw new Error(`Odczyt odrzucony przez rdzeń AI (HTTP ${res.status}).`);
    }

    const payload = (await res.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    };
    const candidate = payload.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const truncated = candidate?.finishReason === "MAX_TOKENS";
    if (raw === null) {
      await logEvent("warn", `extract ${data.mode}: no JSON`, {
        finish_reason: candidate?.finishReason ?? null,
      } as Json);
      throw new Error(
        truncated
          ? "Zdjęcie zawiera za dużo tekstu na jeden odczyt — podziel je na dwa skany."
          : "Rdzeń AI nie odczytał zdjęcia — spróbuj ponownie, z bliska i przy lepszym świetle.",
      );
    }

    const draft = normalizeScan(data.mode, raw);
    const latencyMs = Date.now() - startedAt;
    await logEvent("info", `extract ${data.mode} · ${latencyMs}ms`, {
      latency_ms: latencyMs,
      model,
      mode: data.mode,
      ...(draft.mode === "receipt" && { items: draft.draft.items.length }),
    } as Json);
    return { ...draft, model, latencyMs, truncated };
  });

const SaveInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("receipt"), data: SCAN_SCHEMAS.receipt }),
  z.object({ mode: z.literal("odometer"), data: SCAN_SCHEMAS.odometer }),
  z.object({ mode: z.literal("document"), data: SCAN_SCHEMAS.document }),
  z.object({ mode: z.literal("fridge"), data: SCAN_SCHEMAS.fridge }),
]);

const SaveScanInput = z.object({
  scan: SaveInput,
  editedFields: z.number().int().min(0).max(10_000).default(0),
  model: z.string().max(80).nullable().default(null),
  /** Optional: no photo → only the fields are kept. */
  photo: ImageSchema.nullable().default(null),
  /** The phone's calendar day — an odometer reading is logged on it. */
  localDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SavedScan = {
  id: string;
  photoKeptUntil: string | null;
  purgedPhotos: number;
  /** Where the confirmed scan went (S4.2): every mode lands somewhere useful. */
  routed: Routed;
};

export type Routed =
  | { kind: "expense"; id: string; total: number; currency: string; merchant: string }
  | { kind: "vehicle"; id: string; odometerKm: number }
  /** Still to be chunked and embedded: the client calls processDocumentFn. */
  | { kind: "document"; id: string; title: string }
  | { kind: "note"; id: string; title: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const saveScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveScanInput.parse(input))
  .handler(async ({ data, context }): Promise<SavedScan> => {
    const { supabase, userId } = context;
    const now = new Date();

    let photoPath: string | null = null;
    let expiresAt: string | null = null;
    if (data.photo) {
      const ext = data.photo.mimeType.split("/")[1].replace("jpeg", "jpg");
      const path = `${userId}/${now.toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, base64ToBytes(data.photo.imageBase64), {
          contentType: data.photo.mimeType,
          upsert: false,
        });
      // A lost photo must not lose the confirmed fields — save them anyway.
      if (!upErr) {
        photoPath = path;
        expiresAt = new Date(now.getTime() + PHOTO_RETENTION_DAYS * 86_400_000).toISOString();
      } else {
        await supabase.from("system_events").insert({
          owner_id: userId,
          level: "warn",
          source: "tool.vision_save",
          message: `photo upload failed: ${upErr.message}`,
          meta: {} as Json,
        });
      }
    }

    const { data: row, error } = await supabase
      .from("vision_scans")
      .insert({
        owner_id: userId,
        mode: data.scan.mode,
        data: data.scan.data as unknown as Json,
        edited_fields: data.editedFields,
        model: data.model,
        photo_path: photoPath,
        photo_expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
      throw new Error(`Nie udało się zapisać skanu: ${error?.message ?? "brak odpowiedzi"}`);
    }

    // Every confirmed scan lands where it's useful (S4.2): a receipt is an
    // expense, an odometer reading goes to the car's log, a document to the
    // RAG archive (→ a star in Mózg), the fridge to a note. If that write
    // fails the scan is rolled back too, so a retry starts clean.
    const rollback = async (why: string): Promise<never> => {
      await supabase.from("vision_scans").delete().eq("id", row.id);
      if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
      throw new Error(`Skan nie trafił na miejsce: ${why}`);
    };
    const day = data.localDate ?? now.toISOString().slice(0, 10);
    let routed: Routed;
    switch (data.scan.mode) {
      case "receipt": {
        const r = data.scan.data;
        const { data: exp, error: expErr } = await supabase
          .from("expenses")
          .insert({
            owner_id: userId,
            scan_id: row.id,
            merchant: r.merchant,
            spent_on: r.date,
            total: r.total,
            currency: r.currency,
          })
          .select("id")
          .single();
        if (expErr || !exp) return rollback(expErr?.message ?? "brak odpowiedzi");
        if (r.items.length) {
          const { error: itErr } = await supabase.from("expense_items").insert(
            r.items.map((it, position) => ({
              owner_id: userId,
              expense_id: exp.id,
              position,
              name: it.name,
              qty: it.qty,
              price: it.price,
              category: it.category,
            })),
          );
          if (itErr) {
            await supabase.from("expenses").delete().eq("id", exp.id);
            return rollback(itErr.message);
          }
        }
        routed = {
          kind: "expense",
          id: exp.id,
          total: r.total,
          currency: r.currency,
          merchant: r.merchant,
        };
        break;
      }
      case "odometer": {
        const o = data.scan.data;
        const { data: log, error: logErr } = await supabase
          .from("vehicle_log")
          .insert({
            owner_id: userId,
            scan_id: row.id,
            logged_on: day,
            odometer_km: o.odometerKm,
            fuel_liters: o.fuelLiters,
            amount_pln: o.amountPln,
            note: o.note,
          })
          .select("id")
          .single();
        if (logErr || !log) return rollback(logErr?.message ?? "brak odpowiedzi");
        routed = { kind: "vehicle", id: log.id, odometerKm: o.odometerKm };
        break;
      }
      case "document": {
        const d = data.scan.data;
        const md = new TextEncoder().encode(documentMarkdown(d, day));
        const docId = crypto.randomUUID();
        const filename = `${d.title.slice(0, 120)}.md`;
        const storagePath = `${userId}/${docId}/${sanitizeFilename(filename)}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(storagePath, md, { contentType: "text/markdown", upsert: false });
        if (upErr) return rollback(upErr.message);
        const { error: docErr } = await supabase.from("documents").insert({
          id: docId,
          user_id: userId,
          filename,
          mime_type: "text/markdown",
          storage_path: storagePath,
          size_bytes: md.byteLength,
          status: "uploading",
        });
        if (docErr) {
          await supabase.storage.from("documents").remove([storagePath]);
          return rollback(docErr.message);
        }
        routed = { kind: "document", id: docId, title: d.title };
        break;
      }
      case "fridge": {
        const note = fridgeNote(data.scan.data, day);
        const { data: n, error: nErr } = await supabase
          .from("notes")
          .insert({
            owner_id: userId,
            title: note.title,
            body: note.body,
            tags: ["vision", "lodówka"],
            source: "vision",
          })
          .select("id")
          .single();
        if (nErr || !n) return rollback(nErr?.message ?? "brak odpowiedzi");
        routed = { kind: "note", id: n.id, title: note.title };
        break;
      }
    }

    // Retention: photos past their 30 days go; the scan's fields stay.
    let purgedPhotos = 0;
    const { data: expired } = await supabase
      .from("vision_scans")
      .select("id, photo_path")
      .eq("owner_id", userId)
      .not("photo_path", "is", null)
      .lt("photo_expires_at", now.toISOString())
      .limit(100);
    const paths = (expired ?? []).flatMap((e) => (e.photo_path ? [e.photo_path] : []));
    if (paths.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (!rmErr) {
        await supabase
          .from("vision_scans")
          .update({ photo_path: null })
          .in(
            "id",
            (expired ?? []).map((e) => e.id),
          );
        purgedPhotos = paths.length;
      }
    }

    return { id: row.id, photoKeptUntil: expiresAt, purgedPhotos, routed };
  });
