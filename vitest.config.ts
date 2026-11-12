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
    // `npm run test:coverage` — pomiar bez progu (plan naprawczy, etap 0).
    // Próg dla src/lib/agents dochodzi w etapie 9.
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
    },
  },
});
