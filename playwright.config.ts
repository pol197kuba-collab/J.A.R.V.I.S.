// Test dymny w przeglądarce (plan naprawczy, etap 9). Uruchamia go
// .github/workflows/e2e.yml na lokalnej bazie Supabase; zmienne
// JARVIS_SUPABASE_* ustawia workflow z `supabase status`.
import { defineConfig } from "@playwright/test";
import { APP_PORT, MOCK_PORT } from "./e2e/fixtures";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx --yes tsx@4.21.0 e2e/gemini-mock.ts",
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Wtyczka Lovable słucha domyślnie na [::]; w CI jawnie IPv4.
      command: `npm run dev -- --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        JARVIS_SUPABASE_URL: process.env.JARVIS_SUPABASE_URL ?? "",
        JARVIS_SUPABASE_PUBLISHABLE_KEY: process.env.JARVIS_SUPABASE_PUBLISHABLE_KEY ?? "",
        JARVIS_SUPABASE_SERVICE_ROLE_KEY: process.env.JARVIS_SUPABASE_SERVICE_ROLE_KEY ?? "",
        JARVIS_GEMINI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1beta/models`,
      },
    },
  ],
});
