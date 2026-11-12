import { describe, it, expect } from "vitest";
import { clearOwnerSecrets, readOwnerSecrets, writeOwnerSecrets } from "./ownerSecrets.server";
import { makeDb } from "@/lib/agents/runtime.testkit";
import { testSecretsDb } from "@/test/secretsDb";

// A5 (plan naprawczy, etap 5): user_secrets tylko przez klienta service role.
// W testach klient sekretów to atrapa z src/test/setup.ts (testSecretsDb).

describe("ownerSecrets", () => {
  it("odczyt: wybrane kolumny właściciela przez klienta sekretów", async () => {
    const { db, calls } = makeDb((t) =>
      t === "user_secrets" ? { data: { gemini_api_key: "k" }, error: null } : undefined,
    );
    const res = await readOwnerSecrets("owner-1", "gemini_api_key");
    expect(res.data?.gemini_api_key).toBe("k");
    expect(testSecretsDb.current).toBe(db);
    expect(calls[0].ops).toEqual([
      { method: "select", args: ["gemini_api_key"] },
      { method: "eq", args: ["owner_id", "owner-1"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("zapis: upsert po owner_id z podanymi kluczami", async () => {
    const { calls } = makeDb(() => undefined);
    expect(await writeOwnerSecrets("owner-1", { groq_api_key: "g" })).toEqual({ error: null });
    expect(calls[0].ops[0]).toEqual({
      method: "upsert",
      args: [{ owner_id: "owner-1", groq_api_key: "g" }, { onConflict: "owner_id" }],
    });
  });

  it("czyszczenie: tylko wskazane kolumny, tylko wiersz właściciela", async () => {
    const { calls } = makeDb(() => undefined);
    await clearOwnerSecrets("owner-1", ["google_cse_api_key", "google_cse_cx"]);
    expect(calls[0].ops).toEqual([
      { method: "update", args: [{ google_cse_api_key: null, google_cse_cx: null }] },
      { method: "eq", args: ["owner_id", "owner-1"] },
    ]);
  });

  it("brak klienta service role: błąd w wyniku, nie wyjątek", async () => {
    testSecretsDb.current = null;
    const res = await readOwnerSecrets("owner-1", "gemini_api_key");
    expect(res.data).toBeNull();
    expect(res.error?.message).toContain("brak atrapy");
  });
});
