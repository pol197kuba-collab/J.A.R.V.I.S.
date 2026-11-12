import { describe, it, expect } from "vitest";
import { ENRICH_CLAIM_TTL_MS, ENRICH_GRACE_MS, imageNeedsEnrich } from "./enrichQueue";

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("imageNeedsEnrich", () => {
  it("podejmuje grafiki czekające dłużej niż 90 s bez przejęcia", () => {
    expect(
      imageNeedsEnrich(
        { imageStatus: "pending", createdAt: ago(ENRICH_GRACE_MS + 1000), claimedAt: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("zostawia świeży plik przeglądarce, która właśnie dogrywa", () => {
    expect(
      imageNeedsEnrich({ imageStatus: "pending", createdAt: ago(20_000), claimedAt: null }, NOW),
    ).toBe(false);
  });

  it("nie rusza żywego przejęcia, podejmuje wygasłe", () => {
    const old = ago(ENRICH_GRACE_MS * 10);
    expect(
      imageNeedsEnrich({ imageStatus: "pending", createdAt: old, claimedAt: ago(60_000) }, NOW),
    ).toBe(false);
    expect(
      imageNeedsEnrich(
        { imageStatus: "pending", createdAt: old, claimedAt: ago(ENRICH_CLAIM_TTL_MS + 1000) },
        NOW,
      ),
    ).toBe(true);
  });

  it("ignoruje pliki gotowe, bez grafik i z zepsutą datą", () => {
    for (const imageStatus of ["ready", "failed", "none"]) {
      expect(
        imageNeedsEnrich({ imageStatus, createdAt: ago(86_400_000), claimedAt: null }, NOW),
      ).toBe(false);
    }
    expect(imageNeedsEnrich({ imageStatus: "pending", createdAt: "x", claimedAt: null }, NOW)).toBe(
      false,
    );
  });
});
