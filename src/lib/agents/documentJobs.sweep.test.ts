import { describe, it, expect, vi } from "vitest";
import { makeDb } from "./runtime.testkit";

const enrich = vi.fn(async (_db: unknown, _owner: string, _fileId: string) => ({
  ok: true as const,
  imageCount: 2,
  status: "ready" as const,
}));
vi.mock("@/lib/documents/generated.functions", () => ({ enrichGeneratedFileImages: enrich }));

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("sweepPendingImages", () => {
  it("dogrywa tylko pliki porzucone przez przeglądarkę, najwyżej 3 naraz", async () => {
    const rows = [
      { id: "fresh", image_status: "pending", created_at: ago(10_000), image_claimed_at: null },
      ...["a", "b", "c", "d"].map((id) => ({
        id,
        image_status: "pending",
        created_at: ago(5 * 60_000),
        image_claimed_at: null,
      })),
    ];
    const { db } = makeDb((t) =>
      t === "generated_files" ? { data: rows, error: null } : undefined,
    );
    const { sweepPendingImages } = await import("./documentJobs.rescue");
    const summary = await sweepPendingImages(db, "u1", NOW);
    expect(enrich.mock.calls.map((c) => c[2])).toEqual(["a", "b", "c"]);
    expect(summary).toEqual({ enriched: 3, skipped: 2, errors: [] });
  });
});
