import { defineConfig } from "vitest/config";

// Standalone Vitest config — deliberately NOT reusing vite.config.ts, whose
// TanStack Start / Lovable plugins are dev-server oriented and irrelevant
// (or actively harmful) inside a node test run. Only the "@/..." path alias
// is shared, via Vite 8's native tsconfig paths resolution.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // `npm run test:coverage` — pomiar od etapu 0; od etapu 9 CI uruchamia go
    // z progiem dla src/lib/agents na poziomie osiągniętym po etapie 4
    // (linie 51,82%, Dziennik planu naprawczego) — żeby pokrycie nie spadało.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.testkit.ts",
        "src/integrations/supabase/types.ts",
        "src/routeTree.gen.ts",
      ],
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: {
        "src/lib/agents/**": { lines: 51.82 },
      },
    },
  },
});
