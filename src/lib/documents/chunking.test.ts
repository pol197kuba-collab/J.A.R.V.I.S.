import { describe, it, expect } from "vitest";
import { chunkText, sanitizeFilename, CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS } from "./chunking";

describe("chunkText", () => {
  it("returns [] for empty or whitespace-only input", () => {
    expect(chunkText("", 100, 20)).toEqual([]);
    expect(chunkText("   \n\n  \t ", 100, 20)).toEqual([]);
  });

  it("returns a single chunk for a short paragraph", () => {
    expect(chunkText("Krótki akapit.", 100, 20)).toEqual(["Krótki akapit."]);
  });

  it("normalises CRLF so Windows uploads split into the same paragraphs", () => {
    const unix = chunkText("Akapit A.\n\nAkapit B.", 100, 20);
    const windows = chunkText("Akapit A.\r\n\r\nAkapit B.", 100, 20);
    expect(windows).toEqual(unix);
  });

  it("packs multiple paragraphs into one chunk while they fit", () => {
    const chunks = chunkText("aaa\n\nbbb\n\nccc", 100, 20);
    expect(chunks).toEqual(["aaa\n\nbbb\n\nccc"]);
  });

  it("starts a new chunk when the next paragraph would overflow, carrying overlap", () => {
    const p1 = "x".repeat(60);
    const p2 = "y".repeat(60);
    const chunks = chunkText(`${p1}\n\n${p2}`, 100, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    // Second chunk opens with the 20-char tail of the previous chunk.
    expect(chunks[1]).toBe(`${"x".repeat(20)}\n\n${p2}`);
  });

  it("hard-slices a single oversized paragraph with overlap between slices", () => {
    const para = "abcdefghij".repeat(30); // 300 chars, no paragraph breaks
    const chunks = chunkText(para, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    // Consecutive slices share the 20-char overlap.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith(chunks[i - 1].slice(-20))).toBe(true);
    }
    // Nothing is lost: stitching the slices back (dropping each overlap)
    // reproduces the original paragraph.
    const stitched =
      chunks[0] +
      chunks
        .slice(1)
        .map((c) => c.slice(20))
        .join("");
    expect(stitched).toBe(para);
  });

  it("never emits an empty chunk", () => {
    const messy = "\n\n\n  \n\naaa\n\n\n\n  \n\nbbb\n\n";
    for (const c of chunkText(messy, 50, 10)) {
      expect(c.trim().length).toBeGreaterThan(0);
    }
  });

  it("production constants: chunk size comfortably exceeds overlap", () => {
    // Guards against a config edit that would make overlap >= chunk size,
    // which would stall or explode the hard-slice loop.
    expect(CHUNK_OVERLAP_CHARS).toBeLessThan(CHUNK_SIZE_CHARS);
    expect(CHUNK_OVERLAP_CHARS).toBeGreaterThan(0);
  });
});

describe("sanitizeFilename", () => {
  it("replaces path separators and special characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFilename("raport końcowy (v2).pdf")).toBe("raport_ko_cowy__v2_.pdf");
  });

  it("keeps safe characters intact", () => {
    expect(sanitizeFilename("notes_2026-07.md")).toBe("notes_2026-07.md");
  });

  it("caps length at 120 characters", () => {
    expect(sanitizeFilename("a".repeat(300)).length).toBe(120);
  });

  it("falls back to 'file' when nothing survives", () => {
    expect(sanitizeFilename("")).toBe("file");
  });
});
