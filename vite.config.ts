// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// Publishable (public) Supabase values — safe to embed in the client bundle.
// They are the single source of truth for which database the app talks to.
// Deliberately NOT read from VITE_SUPABASE_* env: Lovable Cloud injects those
// for its own built-in database, which this app no longer uses. Override per
// build with JARVIS_SUPABASE_URL / JARVIS_SUPABASE_PUBLISHABLE_KEY if needed.
// TODO(migracja): podmienić na wartości nowego projektu Supabase.
const SUPABASE_URL = process.env.JARVIS_SUPABASE_URL ?? "https://myjynbqzlovanoarppyt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.JARVIS_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15anluYnF6bG92YW5vYXJwcHl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTkxMzUsImV4cCI6MjA5ODYzNTEzNX0.Gg7xhuBBoGFrUTXsdNFk-dGCoxJOmguO8Z-xYiMJ0KY";
// Project ref = subdomain of the URL; derived so it can never drift from it.
const SUPABASE_PROJECT_ID = new URL(SUPABASE_URL).hostname.split(".")[0];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(SUPABASE_PROJECT_ID),
    },
  },
});
