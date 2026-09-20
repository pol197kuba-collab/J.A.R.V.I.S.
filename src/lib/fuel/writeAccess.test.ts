import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetWriteClientProbe, resolveWriteClient } from "./writeAccess.server";

// Regresja na realny kształt tej instalacji: J.A.R.V.I.S. jest podpięty pod
// Supabase przez Lovable i SUPABASE_SERVICE_ROLE_KEY nie jest ustawiony
// w środowisku aplikacji — żadna funkcja przed modułem paliwowym go nie
// potrzebowała. Bez tej gałęzi pierwsze wejście na /paliwa kończyło się
// wyjątkiem „Missing Supabase environment variable(s)" zamiast wykresem
// z cache'u.

const ORIGINAL = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  __resetWriteClientProbe();
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL.url;
  if (ORIGINAL.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL.key;
  __resetWriteClientProbe();
  vi.restoreAllMocks();
});

describe("resolveWriteClient", () => {
  it("zwraca null, gdy brakuje klucza service_role", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // client.server.ts loguje błąd konfiguracji — tu jest oczekiwany.
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWriteClient()).resolves.toBeNull();
  });

  it("zwraca null, gdy brakuje adresu projektu", async () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveWriteClient()).resolves.toBeNull();
  });

  it("zwraca klienta, gdy oba sekrety są ustawione", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

    const client = await resolveWriteClient();
    expect(client).not.toBeNull();
    expect(typeof client?.from).toBe("function");
  });

  it("sprawdza konfigurację raz, nie przy każdym żądaniu", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

    const first = await resolveWriteClient();
    // Zmiana środowiska po pierwszym sprawdzeniu nie ma prawa go unieważnić
    // — wynik jest zapamiętany na czas życia procesu.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const second = await resolveWriteClient();

    expect(second).toBe(first);
  });
});
