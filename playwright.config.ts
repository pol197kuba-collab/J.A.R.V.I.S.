import { defineConfig, devices } from "@playwright/test";

// Route smoke test (e2e/smoke.spec.ts): boots the app against a dummy
// Supabase (nothing answers on :54321), walks every screen in HUD and Town
// mode on a desktop and a phone viewport, and fails on uncaught errors,
// horizontal page overflow or a visible native scrollbar (CLAUDE.md rule).
// Real data flows (agents, LLM calls, DB writes) are out of scope here —
// those need a test Supabase project.

const PORT = 5174;
const DUMMY_ENV = {
  VITE_SUPABASE_URL: "http://localhost:54321",
  VITE_SUPABASE_PUBLISHABLE_KEY: "e2e",
  VITE_SUPABASE_PROJECT_ID: "localhost",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_PUBLISHABLE_KEY: "e2e",
  SUPABASE_SERVICE_ROLE_KEY: "e2e",
};

const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : {};

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [
    {
      name: "hud-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      metadata: { mode: "hud" },
    },
    { name: "hud-phone", use: { ...devices["Pixel 7"], launchOptions }, metadata: { mode: "hud" } },
    {
      name: "town-desktop",
      use: { viewport: { width: 1440, height: 900 } },
      metadata: { mode: "town" },
    },
    {
      name: "town-phone",
      use: { ...devices["Pixel 7"], launchOptions },
      metadata: { mode: "town" },
    },
  ],
  webServer: {
    command: `npx vite dev --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    env: DUMMY_ENV,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stderr: "ignore",
  },
});
