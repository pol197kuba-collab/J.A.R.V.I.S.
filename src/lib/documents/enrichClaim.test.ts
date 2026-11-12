import { describe, it, expect, vi } from "vitest";
import { makeDb, has, eqValue, firstArg } from "@/lib/agents/runtime.testkit";

// Plan naprawczy, etap 6: dogrywanie grafik też podnosi przeglądarka ORAZ
// kolejka w tle. Przejęcie to jeden warunkowy UPDATE znacznika
// image_claimed_at — drugi przebieg nie generuje obrazków drugi raz.
const generateDocImages = vi.fn(async () => ({ hero: null, sections: new Map() }));
vi.mock("@/lib/agents/forgeDocument.server", () => ({
  generateDocImages,
  buildDocument: vi.fn(),
  CONTENT_TYPES: {},
}));

const FILE = {
  id: "22222222-2222-2222-2222-222222222222",
  format: "pptx",
  storage_path: "u1/a.pptx",
  preview_path: null,
  image_status: "pending",
  spec: { format: "pptx", slides: [] },
};

function world(claimWins: boolean) {
  return makeDb((table, ops) => {
    if (table === "user_secrets") return { data: { gemini_api_key: "k" }, error: null };
    if (table === "generated_files" && has(ops, "update")) {
      if ("image_claimed_at" in (firstArg(ops, "update") ?? {}) && has(ops, "select")) {
        return { data: claimWins ? { id: FILE.id } : null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "generated_files") return { data: FILE, error: null };
    return undefined;
  });
}

describe("przejęcie dogrywania grafik", () => {
  it("przegrany wyścig: bez generowania obrazków", async () => {
    generateDocImages.mockClear();
    const { db } = world(false);
    const { enrichGeneratedFileImages } = await import("./generated.functions");
    expect(await enrichGeneratedFileImages(db, "u1", FILE.id)).toEqual({
      ok: false,
      reason: "not_pending",
    });
    expect(generateDocImages).not.toHaveBeenCalled();
  });

  it("wygrany: warunek na pending i wygasły znacznik, potem generowanie", async () => {
    generateDocImages.mockClear();
    const { db, calls } = world(true);
    const { enrichGeneratedFileImages } = await import("./generated.functions");
    await enrichGeneratedFileImages(db, "u1", FILE.id);
    const claim = calls.find(
      (c) =>
        c.table === "generated_files" && "image_claimed_at" in (firstArg(c.ops, "update") ?? {}),
    );
    expect(claim).toBeDefined();
    expect(eqValue(claim!.ops, "image_status")).toBe("pending");
    expect(has(claim!.ops, "or")).toBe(true);
    expect(generateDocImages).toHaveBeenCalled();
  });
});
