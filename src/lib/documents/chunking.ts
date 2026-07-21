// Pure text helpers for the document pipeline, extracted from
// documents.functions.ts so they can be unit-tested without importing the
// server-function module (createServerFn, Supabase middleware) into tests.

// Chunking: paragraph-aware, ~1200 chars per chunk with 150 chars of
// overlap so a fact split across a chunk boundary is still findable from
// either side.
export const CHUNK_SIZE_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

// Paragraph-aware chunker: fills chunks up to CHUNK_SIZE_CHARS from whole
// paragraphs, carrying the tail of the previous chunk forward as overlap.
// A single paragraph larger than the chunk size is hard-sliced with the
// same overlap rather than left oversized.
export function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      pushCurrent();
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + chunkSize, para.length);
        chunks.push(para.slice(start, end));
        if (end === para.length) break;
        start = end - overlap;
      }
      continue;
    }
    if (current.length + para.length + 2 > chunkSize) {
      pushCurrent();
      const tail = chunks[chunks.length - 1]?.slice(-overlap) ?? "";
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  pushCurrent();
  return chunks;
}
