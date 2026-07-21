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
  },
});
