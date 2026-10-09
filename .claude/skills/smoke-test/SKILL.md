---
name: smoke-test
description: Run and drive the J.A.R.V.I.S. app in a browser without a real backend — the Playwright screen smoke test (every route, HUD/Town, desktop/phone), plus ad-hoc screenshots and Town simulations. Use after UI changes, before opening a PR that touches screens, or when asked to check/test/screenshot the app.
---

# Smoke-testing J.A.R.V.I.S.

The app needs Supabase, but nothing has to answer for the UI to render:
every request to the dummy URL fails fast and screens show their empty or
error states. That is enough to catch crashes, layout overflow and rule
violations. It is **not** enough to test agents, LLM calls or DB writes —
say so instead of claiming those were tested.

## 1. The automated suite (same as CI's "screens smoke" job)

```bash
# in this cloud container Chromium lives in /opt/pw-browsers
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
# one variant only
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --project=town-phone
```

- `playwright.config.ts` starts `vite dev` on :5174 with dummy Supabase env.
- `e2e/smoke.spec.ts` boots once (clicks ENGAGE until the boot screen is
  gone), then visits every route **in-app** (pushState + popstate — a reload
  would replay the boot sequence) and fails on uncaught errors, sideways page
  scroll, or a visible native scrollbar (CLAUDE.md `no-scrollbar` rule).
- **New page → add its path to `ROUTES`** in `e2e/smoke.spec.ts`.
- On failure the message lists screen → problem; screenshots land in
  `test-results/`.

## 2. Ad-hoc checks (screenshots, a specific flow)

Start the dev server:

```bash
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=x \
VITE_SUPABASE_PROJECT_ID=localhost SUPABASE_URL=http://localhost:54321 \
SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
npx vite dev --port 5173 --host 127.0.0.1
```

In a Playwright script (`chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`):

- **Signed in:** before load, put a fake session in
  `localStorage["sb-localhost-auth-token"]` — any JWT-shaped token with a
  future `exp` (copy `fakeSession()` from `e2e/smoke.spec.ts`).
- **UI mode:** `localStorage["jarvis.uiMode"] = "town" | "hud"`.
- **Boot:** click the ENGAGE button (retry until it disappears), then wait
  ~5 s for the dashboard.
- **Town simulation (dev only):** `window.__town = { world, director }`.
  Feed fake runs with `director.ingest({ agents: [], runs: [...] })` (first
  call is a baseline, events come from the diff), steer with
  `world.userWalkTo([x, y])`, read `world.reachable()`, force night with
  `window.__townNight = 1`.
- The first page load after starting Vite compiles for ~20–40 s; warm it up
  once before timing-sensitive steps.

Check new UI in **both** modes and on a ~390 px viewport (CLAUDE.md).
