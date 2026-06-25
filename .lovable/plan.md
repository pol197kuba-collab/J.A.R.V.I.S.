# JARVIS Dashboard — Plan

A dark, Iron Man-inspired AI assistant interface with deep blacks/graphite surfaces and neon cyan accents. Frontend-only with mock data.

## Design system (src/styles.css)
- Dark-only palette: background `#05080d`, surface `#0b1118`, elevated `#101822`, border `#1a2734`.
- Accent: neon cyan `#00e5ff` + soft blue glow `#3ab6ff`; danger `#ff3b5c`; success `#5cffb1`.
- Tokens: `--glow-primary` (cyan shadow), `--gradient-core` (radial cyan→blue→transparent), `--grid-bg` (faint hex/grid pattern via `background-image`).
- Font: Orbitron (display/numbers) + Inter (body), loaded via `<link>` in `__root.tsx`.
- Custom keyframes: `pulse-core`, `ring-spin`, `wave-bars`, `scanline`, `flicker`.

## Routing (TanStack)
- `__root.tsx` — wraps everything in `SidebarProvider`, dark background, grid overlay, font links, sets `<html class="dark">`.
- `src/routes/index.tsx` → Dashboard (the main screen).
- `src/routes/agent-hub.tsx`, `src/routes/system-logs.tsx`, `src/routes/settings.tsx` — minimal placeholder pages styled in-system (lists/cards with mock data) so nav works end-to-end.

## Components
- `AppSidebar` (uses shadcn sidebar) — JARVIS logo mark (animated reactor mini icon), nav items Dashboard / Agent Hub / System Logs / Settings, status footer ("CORE ONLINE", uptime, version).
- `ReactorCore` — CSS-only centerpiece: concentric rotating rings, pulsing inner orb, radial cyan glow, subtle scanline. Reacts to `isListening` (faster pulse, brighter glow).
- `VoiceButton` — large circular mic button below the core. Click toggles listening state; while active shows animated waveform bars (8–12 bars with staggered scaleY animation) and a ripple ring.
- `ChatPanel` — message list with user (right, muted surface) and JARVIS (left, cyan-tinted bubble, monospace prefix `J.A.R.V.I.S //`). Input row with send button. Mock conversation seeded; sending appends user msg + canned assistant reply after short delay (setTimeout, no backend).
- `ActiveTasksWidget` — card list of in-progress agent tasks: title, subsystem tag, progress bar, status dot (running/queued/warning), elapsed time. 4–5 realistic mock entries (Generating report, Monitoring Discord, Indexing repo, Calendar sync, Threat scan).
- `SystemStatsStrip` (small, supports the hero) — CPU / Memory / Network / Latency tiles with mini sparkline-style bars; mock values.

## Dashboard layout
```
┌─────────┬───────────────────────────────────────────────┐
│         │  Top stats strip (CPU/MEM/NET/LAT)            │
│ Sidebar │  ┌───────────────────┐ ┌───────────────────┐  │
│         │  │   Reactor Core    │ │  Active Tasks     │  │
│         │  │   + Voice button  │ │  (scroll list)    │  │
│         │  └───────────────────┘ └───────────────────┘  │
│         │  ┌─────────────────────────────────────────┐  │
│         │  │ Chat panel (history + input)            │  │
│         │  └─────────────────────────────────────────┘  │
└─────────┴───────────────────────────────────────────────┘
```
Responsive: stacks to single column under `lg`.

## Mock data
- `src/data/mock.ts` exports `initialMessages`, `activeTasks`, `systemLogs`, `agents`, `systemStats` — realistic, in-character JARVIS voice ("Good evening, sir. All systems nominal.").

## Out of scope (mock-only for now)
- No real voice recognition, no AI backend, no persistence. Voice button only toggles UI state. Chat replies are canned from a small pool.

## Technical notes
- All colors via semantic tokens; no hard-coded hex in components.
- Animations are pure CSS (keyframes in styles.css) for performance.
- SEO head on each route (title/description).
- Verify `<Outlet />` present in `__root.tsx`; sidebar collapsible to icon mode.
