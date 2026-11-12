// Wspólna konfiguracja testów (vitest.config.ts → setupFiles).
//
// Plan naprawczy, etap 5 (A5): user_secrets czyta tylko klient service role
// (src/lib/secrets/secretsDb.server.ts). W testach nie ma takiego klienta —
// podmieniamy go na atrapę bazy testu (src/test/secretsDb.ts).
import { vi } from "vitest";

vi.mock("@/lib/secrets/secretsDb.server", async () => {
  const { testSecretsDb } = await import("./secretsDb");
  return {
    secretsDb: async () => {
      if (!testSecretsDb.current) throw new Error("test: brak atrapy bazy dla user_secrets");
      return testSecretsDb.current;
    },
  };
});
