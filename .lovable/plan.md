
# Premium AI OS Visual Refresh — v2 (with Background + Sidebar)

Purely a styling pass. No routes, state, business logic, agent code, voice, telemetry, or data changes. Every module keeps its exact position and behavior.

## Scope

Touch only the visual layer:
- `src/styles.css` — tokens, `.hud-panel`, `.hud-corner`, new radius/glow/surface tokens, background layer utilities, sidebar utilities, particle keyframes.
- `src/components/jarvis/DashboardShell.tsx` (or the top-level layout wrapper) — add non-interactive background layer div(s) behind content. No layout changes.
- `src/components/jarvis/AppSidebar.tsx` — className-only refinement of grouping, spacing, active-item glow. Nav items, order, labels, icons, routes, ArcCorePanel, and footer status stay identical.
- `src/components/jarvis/HudPanel.tsx`, `HeaderVoiceToggle.tsx`, and dashboard widget wrappers — className-only softening (from v1 plan).

Nothing else is touched.

---

## 1. Design tokens (`src/styles.css`)

Add without removing existing ones:
- Radius scale: `--radius: 0.875rem`, plus `sm/md/lg/xl/2xl` derived.
- Surfaces: `--surface-1`, `--surface-2`, `--surface-3` (translucent layered fills via `color-mix`).
- Glows: `--glow-soft`, `--glow-md`, `--glow-lg` (layered cyan halo + inset highlight).
- Edges: `--holo-edge` (soft cyan gradient border color).
- Panel wash: `--gradient-panel` (subtle radial cyan).
- Background layer tokens: `--bg-vignette`, `--bg-radial-a`, `--bg-radial-b`, `--bg-grid-soft`.

Keep existing palette; no new hues.

## 2. `.hud-panel` refactor (styles.css only)

- `border-radius: var(--radius-lg)`.
- Layered translucent fill (`--gradient-panel` over `--surface-2`) + faint `backdrop-filter: blur(6px)`.
- Replace hard border with soft gradient outline + inset highlight; softer `--glow-soft`.
- 250ms hover: gentle `translateY(-1px)`, stronger `--glow-md`, brighter edge.
- `.hud-corner` becomes lighter and inset so it reads with rounded corners (kept for identity).

## 3. Background system (new)

Add a fixed, `pointer-events-none`, `z-0` background stack rendered once at the top of `DashboardShell` (behind existing content, which stays on its current `z-10`+ layers). All layers use existing cyan/teal tokens.

Layers (bottom → top):
1. **Base grid** — reuse existing `--grid-bg` at ~4-6% opacity; scale 48px; slow drift via existing `grid-pan` keyframe at 30s.
2. **Radial glows** — two large soft cyan radial gradients pinned to screen thirds (`--bg-radial-a` top-left, `--bg-radial-b` bottom-right), 15-20% opacity, blurred, mix-blend `screen`.
3. **Particle field** — a single CSS layer with ~14 dots using a new `.hud-particle` utility + existing `particle-float` keyframe, randomized inline `--px`/`--py`/`animation-delay`. Very low intensity, cyan tint (not amber). No JS, no canvas.
4. **Vignette** — `radial-gradient(ellipse at center, transparent 55%, black 100%)` overlay for screen-edge darkening.

New CSS utilities:
- `.jarvis-bg-root` — fixed inset-0, pointer-events-none, z-0, contains all layers.
- `.jarvis-bg-grid`, `.jarvis-bg-radials`, `.jarvis-bg-particles`, `.jarvis-bg-vignette`.

`DashboardShell.tsx` change: add a single `<div className="jarvis-bg-root">` with four child divs at the very top of the returned tree. Nothing else moves. No component re-parenting.

## 4. Sidebar refinement (`AppSidebar.tsx`, className only)

Keep navigation entries, order, icons, routes, ArcCorePanel, uptime block — 100% unchanged.

Visual-only tweaks:
- Group `SidebarContent` menu items inside a floating container feel: wrap the existing `SidebarGroupContent` styling (no new JSX nodes) with softer border `border-primary/15`, `bg-[color:var(--surface-1)]`, `rounded-[var(--radius-md)]`, subtle inset highlight. If a wrapper element is needed, add a single `<div>` around the existing `<SidebarMenu>` — no logic, no reorder.
- Nav items:
  - `rounded-[var(--radius-md)]` backgrounds
  - Softer hover: `hover:bg-[color:var(--surface-2)]`, 200ms transition.
  - Active state: subtle glow ring `shadow-[var(--glow-soft)]`, left accent bar (2px cyan) instead of hard tint; keep the existing right dot indicator.
  - Slightly increased vertical spacing between items (`gap-1` → `gap-1.5`).
- `SidebarGroupLabel` gets softer tracking and lower opacity for hierarchy.
- `SidebarHeader` / `SidebarFooter` dividers soften to `border-sidebar-border/40`, add faint top/bottom gradient wash.
- ArcCorePanel container inherits the same rounded soft-panel treatment; internal reactor untouched.

## 5. Component touch-ups (className-only, from v1)

- `HudPanel.tsx` — softer title divider (`border-primary/15`), keep tags/corners.
- `HeaderVoiceToggle.tsx` — swap sharp shadow for layered soft glow, 250ms hover.
- Dashboard widget chips/rows in `SystemStatsStrip`, `ActiveTasksWidget`, `AgentOpsFeed`, `NotesWidget`, `TasksWidget`, `ThreatStream`, `WeatherTelemetry`, `GithubActivityPulse`, `CommandDirectory`, `ChatPanel`:
  - Rounded corners where currently square.
  - `border-primary/20` + `bg-[color:var(--surface-1)]`.
  - `hover:shadow-[var(--glow-soft)] transition`.
- No content, order, or data changes.

## 6. Typography (light touch)

- Body uppercase tracking `0.3em` → `0.22em` on labels touched above.
- `--muted-foreground` lightness bumped one notch for readability. Fonts unchanged.

## What is explicitly NOT changing

- No changes to `PhaseController`, `BootSequence`, `ArkRebootOverlay`, `ArcReactorTriangle`, `PhaseContext`, `TransitionContext`, `VoiceCommandContext`, agents, server functions, Supabase clients, routes, or route metadata.
- Zero moved/renamed/removed features. Zero new dependencies.
- Background is decorative and non-interactive; z-index guarantees it never captures events or overlaps content.

## Verification

- `tsgo` typecheck.
- Playwright screenshot of `/` at 1475x956 to confirm: soft rounded panels, subtle background depth (grid + radials + particles + vignette), refined sidebar with glowing active item, all modules in place.
