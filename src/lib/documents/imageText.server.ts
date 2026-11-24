// DOKUMENTY — zdjęcie → tekst do bazy wiedzy (OCR + opis) przez Gemini.
// Ten sam klucz i ta sama księga zużycia co embeddingi dokumentów; jedno
// wywołanie modelu na zdjęcie.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { callGemini } from "@/lib/ai/llm/gemini";
import type { GeminiUsageMetadata } from "@/lib/ai/llm/usage";

export const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const PROMPT =
  "Jesteś czytnikiem dokumentów J.A.R.V.I.S. Na zdjęciu może być pismo, paragon, " +
  "faktura, tablica, ekran, notatka odręczna albo zwykła scena. Odpowiedz po polsku, " +
  "zwykłym tekstem (bez Markdown), dokładnie w tym układzie:\n" +
  "OPIS: 2–4 zdania — co przedstawia zdjęcie i co jest na nim najważniejsze " +
  "(dla dokumentu: rodzaj, wystawca, data, kwoty).\n" +
  "TEKST ZE ZDJĘCIA:\n<cały czytelny tekst przepisany dokładnie, linia po linii, " +
  "z zachowaniem liczb, dat i kwot; tabele jako wiersze z „ | ” między kolumnami>\n" +
  "Jeśli na zdjęciu nie ma tekstu, po „TEKST ZE ZDJĘCIA:” napisz „(brak)”. Niczego nie zmyślaj.";

/** Bajty → base64 bez Buffer (działa w workerze Cloudflare). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

export async function imageToText(opts: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  apiKey: string;
  db: SupabaseClient<Database>;
  ownerId: string;
}): Promise<string> {
  const res = await callGemini<{
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsageMetadata;
  }>({
    apiKey: opts.apiKey,
    model: DEFAULT_GEMINI_MODEL,
    body: {
      systemInstruction: { parts: [{ text: PROMPT }] },
      generationConfig: {
        temperature: 0.1,
        // czytanie, nie rozumowanie — budżet zostaje na długi tekst
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 8192,
      },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: opts.mimeType, data: toBase64(opts.bytes) } },
            { text: `Odczytaj to zdjęcie (plik: ${opts.filename}).` },
          ],
        },
      ],
    },
    timeoutMs: 60_000,
    retries: 1,
    ledger: { db: opts.db, ownerId: opts.ownerId, module: "documents", purpose: "image_ocr" },
  });
  if (!res.ok) throw new Error(`odczyt zdjęcia nieudany — ${res.message}`);
  const text = (res.data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("model nie odczytał zdjęcia — spróbuj ostrzejszego zdjęcia");
  return `Zdjęcie: ${opts.filename}\n${text}`;
}
