// Embeddingi tekstu (Gemini) — jedno miejsce dla pamięci, RAG, notatek i
// Mózgu 3D. Wydzielone z tools.server.ts, żeby nocny skrypt Mózgu
// (scripts/brain-layout.ts) nie musiał ładować całego rejestru narzędzi.

// Dimensionality of the vector(768) columns (memories, document_chunks,
// notes). Must match the migrations and the value requested from Gemini.
export const EMBED_DIMS = 768;
const EMBED_MODEL = "gemini-embedding-001";

// Turn text into a 768-dim embedding via the user's own Gemini key. Best
// effort by design: any failure (no quota, network, HTTP error, malformed
// response) returns null so the caller falls back to keyword search instead
// of failing the whole tool. `taskType` steers Gemini to produce embeddings
// tuned for either the stored document or the search query.
export async function embedText(
  text: string,
  apiKey: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  timeoutMs = 10_000,
): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${encodeURIComponent(
        apiKey,
      )}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: trimmed.slice(0, 8_000) }] },
          taskType,
          outputDimensionality: EMBED_DIMS,
        }),
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMS) return null;
    return values;
  } catch {
    return null;
  }
}

// supabase-js serialises a vector column value as a JSON-array string, e.g.
// "[0.12,-0.03,…]". Kept as a tiny helper so writers and readers agree on format.
export const toVectorLiteral = (values: number[]): string => JSON.stringify(values);

/** Odwrotność toVectorLiteral — null, gdy to nie jest wektor o długości EMBED_DIMS. */
export function parseVectorLiteral(value: unknown): number[] | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== EMBED_DIMS) return null;
  const out = new Array<number>(parsed.length);
  for (let i = 0; i < parsed.length; i++) {
    const n = parsed[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/** Tekst notatki, z którego liczony jest jej embedding — jeden format wszędzie. */
export const noteEmbeddingText = (title: string, body: string): string =>
  `${title.trim()}\n\n${body.trim()}`.trim();
