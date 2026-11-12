import { describe, it, expect, vi, afterEach } from "vitest";
import { makeDb } from "@/lib/agents/runtime.testkit";

// Plan naprawczy, etap 5: żadna funkcja serwerowa nie zwraca pełnego klucza
// — najwyżej podgląd ostatnich 4 znaków. Sprawdzamy odpowiedzi funkcji
// statusu kluczy i testu kluczy, mając w bazie rozpoznawalne wartości.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => builder };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Handler = (a: { data?: unknown; context: unknown }) => Promise<unknown>;

const SECRETS = {
  gemini_api_key: "GEMINI-SEKRET-1234567890",
  anthropic_api_key: "sk-ant-SEKRET-1234567890",
  groq_api_key: "gsk_SEKRET-1234567890",
  tomtom_api_key: "TOMTOM-SEKRET-1234567890",
  google_cse_api_key: "CSE-SEKRET-1234567890",
  google_cse_cx: "CX-SEKRET-1234567890",
  github_token: "github_pat_SEKRET-1234567890",
};
// Każdy klucz bez ostatnich 4 znaków — tego w odpowiedzi być nie może.
// Wyjątek: google_cse_cx to identyfikator wyszukiwarki (jawny, stoi w jej
// publicznym adresie), nie sekret — Ustawienia pokazują go w całości.
const LEAKS = Object.entries(SECRETS)
  .filter(([col]) => col !== "google_cse_cx")
  .map(([, v]) => v.slice(0, -4));

afterEach(() => vi.unstubAllGlobals());

function world() {
  return makeDb((t) => (t === "user_secrets" ? { data: SECRETS, error: null } : undefined));
}

describe("funkcje serwerowe nie zwracają pełnych kluczy", () => {
  it("statusy kluczy w Ustawieniach: tylko podgląd 4 znaków", async () => {
    const fns = await import("@/lib/agents/runtime.functions");
    const names = [
      "getGeminiKeyStatus",
      "getGroqKeyStatus",
      "getTomtomKeyStatus",
      "getAnthropicKeyStatus",
      "getGoogleCseStatus",
      "getGithubTokenStatus",
    ] as const;
    for (const name of names) {
      const { db } = world();
      const out = JSON.stringify(
        await (fns[name] as unknown as Handler)({ context: { supabase: db, userId: "u1" } }),
      );
      for (const leak of LEAKS) expect(out, `${name} zwraca klucz`).not.toContain(leak);
      expect(out).toContain("linked");
    }
  });

  it("test kluczy: wynik bez kluczy, także gdy dostawca odpowiada błędem", async () => {
    // Dostawca odbija adres żądania w treści błędu (z kluczem w query string).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => ({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => `bad request for ${String(url)}`,
      })),
    );
    const { testProviderKeys } = await import("@/lib/system/keyCheck.functions");
    const { db } = world();
    const out = JSON.stringify(
      await (testProviderKeys as unknown as Handler)({ context: { supabase: db, userId: "u1" } }),
    );
    for (const leak of LEAKS) expect(out, "test kluczy zwraca klucz").not.toContain(leak);
    // Wszyscy dostawcy zostali naprawdę odpytani — test nie przechodzi „na pusto".
    const checks = JSON.parse(out) as { status: string }[];
    expect(checks).toHaveLength(6);
    expect(checks.every((c) => c.status !== "missing")).toBe(true);
  });
});
