# J.A.R.V.I.S. — project conventions

## No visible system scrollbars

Every scrollable panel/widget in this app must hide the native scrollbar
while keeping scrolling fully functional — system scrollbars break the HUD
look. Use the existing `no-scrollbar` Tailwind utility (defined in
`src/styles.css` via `@utility no-scrollbar`) on the scrolling element,
alongside `overflow-y-auto overflow-x-hidden`:

```tsx
<div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">...</div>
```

This applies to every new scrollable container going forward (panels,
chat logs, lists, dropdowns, etc.), not just the ones it's already been
applied to (`HudOverlay`, `AgentRegistryPanel`, `MatrixChatConsole`).

When a scroll container's items have unpredictable-length text, also add
`min-w-0` to the item's inner content wrapper if the row uses `grid` or
`flex` — a `1fr`/flex-basis-0 track's automatic minimum size ignores
`break-words`/`overflow-wrap: break-word` unless the item explicitly opts
out of it with `min-w-0`, which otherwise causes a bogus horizontal
scrollbar on long unbroken tokens (URLs, IDs, etc.).

## Responsive panels: container queries, not viewport variants

Panel-internal layout (text size, stat-tile rows, grids, forms — anything
rendered *inside* a `HudPanel`) must respond to the **panel's own rendered
width**, not the device's viewport orientation. Use Tailwind's container
query variants (`@container` is already set on `HudPanel` and on
`DashboardShell`'s `<main>`) with **arbitrary pixel values**, not the
named `@sm`/`@md` scale (that scale is tuned for full-page containers,
not the ~300–900px range panels actually render at):

```tsx
// Inside a HudPanel's children — queries THIS panel's width:
<div className="flex flex-wrap gap-4 @max-[380px]:gap-2">
<span className="text-sm @max-[380px]:text-xs">

// Outside any HudPanel (a route's own root wrapper, a hero row) — queries
// the page-level container on DashboardShell's <main> instead, since that's
// the nearest ancestor @container:
<div className="grid grid-cols-3 @max-[640px]:grid-cols-1">
```

**Do not use `portrait:`/`landscape:max-md:`/`short:` for panel-internal
content.** Those variants read the *device's* orientation/height, which
doesn't track how much room a panel actually has (a panel can be narrow
on a wide landscape screen if it's one of several side-by-side, and vice
versa) — that mismatch is exactly what caused new dashboard modules to
overflow/overlap on mobile despite "looking fine" during review. A small
number of those variants remain legitimate at the *shell* level only
(`DashboardShell` itself, and routes that deliberately opt into a fixed,
non-scrolling "windowed" viewport like `/jarvis`'s 3D canvas) — don't
add new ones there without a specific reason tied to the physical
viewport, not panel content.

**Pages must stay scrollable.** Don't set `overflow-hidden`/`max-h-full`
on a route's own root wrapper to force everything to fit one screen —
`DashboardShell`'s `<main>` is always `overflow-y-auto`, and fighting
that from inside a route clips content instead of letting the user
scroll to it. If a route genuinely needs a fixed, non-scrolling viewport
(immersive full-bleed views only), give *that route's own wrapper* a
definite height (e.g. `h-[100dvh]`) and `overflow-hidden`, matching the
`/jarvis` pattern — never rely on `<main>` clipping for you.

## Colors & themes: tokens only

All colors come from theme tokens in `src/styles.css`, so a new color theme
is one CSS block, not a hunt through components:

- **Source tokens** live only in the `:root, [data-theme="jarvis"]` block
  (`--background`, `--base-*`, `--primary`, `--accent`, `--reactor`,
  `--reactor-hot`, `--success`, `--warning`, `--destructive`, text colors).
  A new theme = copy that block as `[data-theme="<name>"]` with new values,
  applied on `<html>`.
- **Derived tokens** (borders, glows, grids, `--surface-*`, chrome, sidebar,
  `--chart-1..5`) are computed from the source tokens with `var()` /
  `color-mix()` — never write a literal hue there.
- In components use Tailwind token classes (`text-primary`,
  `border-primary/25`, `bg-background`, `text-reactor`, `text-warning`) or
  `var(--token)` / `color-mix(in oklab, var(--primary) 40%, transparent)` in
  arbitrary values and inline styles. **Never** a literal color (`#4dd8ff`,
  `oklch(...)`, `rgba(...)`) or a Tailwind palette class (`text-cyan-300`,
  `bg-amber-400`).
- SVG gradient stops/fills: set via `style={{ stopColor: "var(--primary)" }}`
  (CSS vars don't resolve in presentation attributes).
- three.js / `<canvas>` can't read CSS vars: use `useThemeColors` /
  `resolveCssColor` from `src/lib/theme/themeColor.ts`.
- Allowed exceptions: neutral black/white shading (shadows, vignettes,
  masks) and the fixed categorical palettes whose color _means_ a
  series/agent (`--fuel-*`, `--market-*`, per-agent sigil hues).
  Also artwork, like `townArt.ts`: the Mózg 3D space scene — planet
  surfaces (`src/lib/brain/planets.ts`), sun, star field and nebula
  (`src/components/brain/space.tsx`). Planets are real-planet colors; the
  module a table belongs to still comes from tokens via the atmosphere
  glow, so don't recolor planets per module.
- Don't reintroduce a `.dark { ... }` palette block: `<html>` has
  `class="dark"` for shadcn's `dark:` variants, and such a block silently
  overrides the whole JARVIS palette (that bug shipped once).

## Agent Town (`/town`) and UI modes

The app has two UI modes (`src/lib/theme/uiMode.ts`): **HUD** (theme
`jarvis`) and **Town** (theme `town`, pixel RPG). A mode is a theme plus a
home view; the header's HUD/TOWN switch changes both. Town reskins every
module through the theme tokens plus the "Town skin" section at the end of
`src/styles.css`, so new modules must keep using tokens and the existing
panel classes (`HudPanel`, `.hud-chrome`, …) to look right in both modes —
check new UI in both before shipping.

The Town map itself lives in `src/components/town/`: `townMap.ts` (floor
plan, BFS — pure, tested), `townArt.ts` (sprites and furniture; its fixed
pixel palette is artwork and is exempt from the token rule, like the
categorical palettes), `townWorld.ts` (characters, actors, render),
`townDirector.ts` (real `agent_runs` → character actions; `diffFlow` is
pure and tested), `townDog.ts` + `dogMood.ts` (the owner's spaniel
companion, Marvel — keep it; it's a personal touch, not demo filler),
`townTalk.ts` + `TownDialog.tsx` (walk-mode conversations; lines are built
only from real run data — never invent agent activity), `townProps.ts` +
`townPropActions.ts` + `TownArcade.tsx` (usable props in walk mode; any fact
they state — documents, run stats — comes from real data), `townIdle.ts`
(what a free agent does; while any task runs they wait at their desks so
hand-offs find them — pure, tested), `townInsights.ts` (error reading,
retry, provider alarm, visit report, time of day — pure, tested) and
`TownView.tsx`.
Walk mode never changes the zoom: the floor stays fully in view and zooming
is the user's choice only. New agents need a room, a look and a
home/visit spot there to appear on the map.

The building has two wings around the original core (east corridor x 42–43,
south corridor y 30). Spare rooms live in `SPARE_ROOMS` (`townMap.ts`):
`exchange` — the trading floor, drawn by `townExchangeArt.ts` from the paper
fund via `townFund.ts` (pure, tested; M.E.T.R.I.C.'s mood comes from there)
— and five `build_*` rooms "w remoncie". A new module takes over a
`build_*` room: give it a label, floor and face, furnish it, and drop the
construction props; don't squeeze new rooms into the core.
Extras (`townNpcs.ts` + `townNpcWorld.ts`): builders in the `build_*` rooms
and traders on the floor, tagged BUD / TRD. They are scenery — never in the
roster, never talkable, and they state nothing about agent work; traders
only shout real ticker lines from the fund. A room that stops being "w
remoncie" takes its builders out of `NPCS`.

## 3D intro and Arc Core v2

One three.js scene runs landing page → 3D login → ignition → Arc Core, and the
`/jarvis` canvas (R3F) shows the same Arc Core. Both are **faithful ports** of
the approved prototype `docs/jarvis-3d-v2/` (the older
`docs/login-scene-prototype/` was removed in stage 8; its `reactor.js` is
identical to v2's) — keep them that way:

- **Fidelity contract:** geometry, segment counts, textures, the simplex core
  shader, bloom/fog/fov numbers, DPR caps, orbit tables (`orbits.ts`) and time
  curves match the prototype. Don't use `MeshDistortMaterial` for the core,
  don't add/remove post-processing, don't "simplify for performance" or retune
  colours/pacing. The only allowed quality drop is DPR (after 120 frames with
  >50% frames over 34 ms, floor `min(devicePixelRatio, 1.25)`) — never
  geometry, shader or bloom. Bloom is three's `UnrealBloomPass` in both
  renderers (`BloomComposer.tsx` inside R3F), not `@react-three/postprocessing`.
- **Switch:** `isLoginSceneEnabled()` in `src/lib/theme/loginScene.ts`
  (`LOGIN_SCENE_DEFAULT_ENABLED` is the one rollout line; `?loginScene=1|0`
  is read once per page load, `localStorage["jarvis.loginScene"]` also works).
  On: 3D landing page, 3D login, ignition, `/jarvis` v2. Off, Town skin or no
  WebGL: the SVG `ArcReactorTriangle` + `BootSequence` + legacy
  `JarvisCanvas`/`Core3D`/`AgentNode3D`. `prefers-reduced-motion: reduce` keeps
  the classic Engage screen but gets the 3D login and a "min" ignition (fade
  to black, no flashes). `pickIntroMode()` decides.
- **Lazy import:** `LoginScene.tsx` loads `createLoginScene.ts` (and with it
  three) via dynamic `import()`; `JarvisCanvas.tsx` loads `arc-core/` via
  `React.lazy`. Never import `three`, `createLoginScene`, `reactor`, `core2`,
  `tunnel` or `arc-core/*` from anything the main bundle or SSR reaches
  (type-only imports are fine). `loginSceneMath.ts`, `orbits.ts`,
  `coreShader.ts`, `sceneColors.ts`, `landingData.ts` stay three-free.
- **Units:** the demo runs in world units (SCALE 72); the app in
  `MATRIX_SCALE` 0.72. For the R3F canvas **every length from the demo is
  multiplied by 0.01** (radii, tubes, ticks, node size, point sizes, camera,
  fog, light distance); light intensity is multiplied by `0.01^decay` so the
  illumination is identical (`arcCoreMath.ts`: `U`, `lightToApp`).
- **Colours:** tokens only, resolved through `themeColor.ts`
  (`sceneColors.ts`, shared by the imperative scene and R3F). In the default
  theme primary/accent/reactor/hot are bit-exact with the prototype; helper
  tints are token `color-mix` fits (max error noted per entry).
- **Lifecycle:** `PhaseController` mounts one `<LoginScene>` (stable key)
  from `booting` (landing) through login_screen, initializing and
  transition_to_dashboard; its modes follow the `phase` prop and it never
  remounts. The dashboard mounts at `P_LIVE`, the overlay turns
  `pointer-events:none` and fades to p = 1, its final frame is aligned onto
  the `/jarvis` canvas (`data-jarvis-canvas-rect`). Everything must be
  disposed on unmount (rAF, geometry, materials, textures, composer,
  renderer + forced context loss, listeners).
- **Landing page:** scrolls its own `fixed` container (`no-scrollbar`), never
  `window`; button jumps run on their own rAF clock (`scrollJump.ts`, constants
  in `loginSceneMath.ts`); Engage must keep doing exactly what
  `BootSequence`'s button does. Copy and the static agent registry live in
  `landingData.ts` (hard-coded: there is no data before login).
- **App start:** `BootSplash` (server-rendered) shows `/icon-512.png` centred on
  black — the same picture Android's system splash draws from the manifest —
  and the scene's first frame is that exact image (the icon is rendered from
  the scene by `scripts/render-app-icon.mjs`; re-run it if the reactor's look
  changes). The splash cross-fades into the scene, which then flies to the
  hero stop (`SPLASH_MS`). Never show another screen before the intro mode is
  known.
- **Scrolling never stalls:** while a panel is pinned the camera drifts
  `DWELL_DRIFT` of the way to the next stop, and gaps use a Hermite curve that
  matches that speed (`gapProgress`), so neither scrolling nor the button jump
  has a dead moment at a panel.
- **Proof harness:** `window.__loginScene` and `window.__queryClient` exist
  only in DEV; `scripts/capture-intro-scene.mjs` screenshots the scene against
  `docs/jarvis-3d-v2/reference/`.

## 3D module transitions

Every module change goes through `TransitionContext.startTransition` (never
`router.navigate` directly from UI). With the 3D switch on, HUD skin, WebGL
and motion allowed, `ModuleTransitionLayer` (lazy `createTransitionScene.ts`,
same chunk rules as the login scene) plays:

- **tunnel** between ordinary modules (950 ms): triangular gates, the target
  module's board at the end;
- **core-enter** into `/jarvis` (1500 ms): camera flies onto the Arc Core and
  hands off to the live R3F canvas (`data-jarvis-canvas-rect`);
- **core-leave** out of `/jarvis` (1350 ms): starts from the live camera
  (`arcCoreLive.ts`, written by `JarvisCanvasV2`) and dives into the agent
  that owns the target module (`MODULE_AGENT` in `transitionMath.ts`).

Repeated jumps within 2.5 s run at ×0.55 duration. Timings and curves live in
`transitionMath.ts` (pure, tested). Town skin, no WebGL, reduced motion,
switch off or layer not loaded yet → the old CSS dematerialize transition.
New modules need a `MODULE_ITEMS` entry (board title) and, if an agent owns
them, a `MODULE_AGENT` entry.

## 3D depth inside modules

With the 3D layer on (same conditions as the transitions), the transition
scene's canvas rests **under** the panels (z-index 5; 70 while a transition or
the menu plays) and shows the same world: the Arc Core with its agents, dimmed
(`BACKDROP_OPACITY`), 30 fps. Every module sees it from its own angle
(`backdropSeed`), the page scroll and the phone tilt / mouse move it slower
than the panels (`backdropMath.ts`, pure and tested). Not under `/jarvis`,
`/mozg`, `/town` (their own canvases: `NO_BACKDROP_PATHS`). The layer sets
`html[data-depth3d]` (panels assemble from the depth on mount, `HudPanel`'s
`hud-depth-in`) and `html[data-backdrop3d]` (the CSS `JarvisBackdrop` rests,
panel glass lets more through). New modules get both for free by using
`HudPanel`; keep panel backgrounds as glass, not opaque fills.

## "Data in space" module content (3D mode)

Under `html[data-depth3d]` modules have **no windows**: the "Data in space"
block in `src/styles.css` (unlayered, so it beats the Tailwind utilities)
strips panels of glass, frames, rim light and shadows, hides `hud-corner` and
`HudTag`, and the content lies on the 3D world. Readability comes from the
`.space-mist` layer (rendered by `ModuleTransitionLayer`, z-index 6: over the
world, under the content), from space between sections and from light:

- section titles (`hud-panel-title`) glow, with a lit dot, no rule;
- `StatTile` numbers are holograms (`holo-stat` / `holo-stat-value`): big,
  glowing, a beam under each, a little parallax from `--mx` / `--my` (set by
  the transition layer from the pointer / phone tilt, quantized + throttled);
- cyan-framed boxes become plain space, one-sided cyan rules lines of light
  fading at both ends; status colours keep their lines;
- tab rows (`role="tab"` + `aria-selected`) and toggle rows (`role="group"`
  of `aria-pressed` buttons) are text, the active one lit with a glowing
  underline; buttons with a `border-primary*` class are light text over a
  glowing underline; fields sit on a line of light and glow on focus.

Charts: `charts3d/RibbonChart3D` (lazy `createRibbonChart.ts`, same chunk
rules as the other three.js code; math in `ribbonMath.ts`, pure and tested)
draws series as ribbons of light over a floor grid, forecasts as beads with a
cone of uncertainty, index mode as series standing one behind another. It
renders on demand only (data, entrance, pointer, resize), never in a loop.
`MarketChart` uses it in the 3D mode and keeps recharts otherwise. Town and
the no-3D path keep the classic panels and charts.

## Mobile dock and the Orbita menu

`MobileBottomNav` is a glass dock: the Arc Core itself in the middle, no frame
(`DockCore`, 64 px: the real /jarvis core in miniature — same shader, rings,
shell, corona and bloom, no agents — from the lazy `createMiniCore.ts` on its
own small canvas blended with `screen`; the CSS `MiniArcCore` stands in
without the 3D layer. Tap opens the menu, a 1 s hold flies to `/jarvis`; it
spins up / glows red from the real agent states), the current module
with one live line on the left (`dockWidgets.ts`, pure and tested — real data
from shared query keys only, no data → no line), agent status dots and the
mic on the right. It slides away while `<main>` scrolls down and returns on
the way up or on a new route.

The menu is `OrbitMenu`: sections, then a section's modules, as nodes on one
orbit around the Arc Core, drawn by the transition scene's menu mode
(`MenuControl` in `createTransitionScene.ts`, math in `orbitMenuMath.ts`).
The component only overlays tap targets and labels at the positions the scene
reports each frame. Picking a module dives into its node and calls
`startTransition(path, { fromMenu: true })`, so the tunnel (or the core, for
`/jarvis`) follows without a cut. One level holds at most
`MENU_MAX_NODES` (8) entries. Without the 3D layer (Town, no WebGL, reduced
motion, switch off, not loaded) the flat radial `ReactorMenu` is used.

## Desktop navigation: the Arc Core and the "Kokpit" menu (3D mode)

On desktop in the 3D mode there is **no sidebar** (`DashboardShell` renders
`DesktopNav` instead of `AppSidebar`): the Arc Core sits at the left end of
the header, where it never covers a module (the same `DockCore` mini core as
the phone dock, 42 px; tap opens the menu,
a 1 s hold flies to `/jarvis`, `useLongPress.ts` shared with the dock) and
`CockpitMenu` is the menu: four holographic columns (the module groups)
standing in an arc around the core in CSS 3D, every module with its one-line
description (`cockpitBlurb`) and one click away; typing filters and picks the
best match (name first, then keywords / description), arrows walk the
columns, Enter opens, Esc / the background close. Logic lives in
`cockpitMenu.ts` (pure, tested), styles in the "Kokpit" block of `styles.css`.
Ctrl/⌘K, `OPEN_COCKPIT_EVENT` and the voice "open menu" command open it too; `CommandPalette` steps aside while
`html[data-cockpit-nav]` is set. While it is open (`html[data-cockpit]`) the
page and the header step back and the 3D backdrop settles on the core with the
agents faded (`BackdropControl.focus`); on routes without a backdrop of their
own (`/jarvis`, `/mozg`, `/town`) the layer turns it on for as long as the menu
is open, so the core is always in the middle. Without the 3D layer the classic
sidebar and ⌘K palette stay.

## Top bar in the 3D mode: the visor

With the 3D layer on (HUD skin, desktop and phone) the top bar is
`VisorHeader` (`DashboardShell.tsx`), not the glass `.hud-chrome` slab: no
background, no boxed controls, no `backdrop-filter` (a frosted strip over the
moving 3D world shows as a blurred band). A fade from the top edge keeps it
readable, controls are glowing text / icons (the lit one gets a glowing
underline), a line of light brightest in the middle closes it — the "Visor"
block in `styles.css`. Left: Arc Core (desktop) + module title as a
hologram; centre: talk to J.A.R.V.I.S. (a mic icon on a narrow bar); right:
status, HUD/TOWN, alerts and SYS (reboot, fullscreen, deactivate in a
holographic tray). Town skin and the no-3D path keep `ClassicHeader`.
New header controls go into one of those groups and must read as light,
not as a bordered box.

## Dojazd do pracy (`/situation-room`)

Situation Room is the commute module (the old flight radar, weather and
GitHub-pulse panels are gone). Data comes from **TomTom** (routes with
traffic, incidents, geocoding) — *not* Google: Google's terms forbid drawing
its routes on another provider's map, which is exactly what the HUD look needs.

- **Code:** `src/lib/commute/` — `tomtom.ts` (pure parsing, `pickDetour`,
  `incidentRuns`), `plan.ts` (`planDeparture`: live traffic only inside the
  window around the planned departure, otherwise the next workday's planned
  time; Mon–Fri only), `alert.ts` (pure push decision), `brief.ts` (facts +
  sentences for the morning brief), `*.server.ts` (network/DB),
  `commute.functions.ts` + `useCommute.ts` (shared query keys: page, home tile
  and mobile dock are one fetch). Tests in `commute.test.ts`.
- **Map:** `components/jarvis/commute/CommuteMap.tsx` — Leaflet (dynamic
  import, same SSR rule as before). Tiles are TomTom's night raster (same key as routing, needs the Map Display API product; CARTO basemaps now demand a paid key) recoloured by the SVG
  duotone filter `#commute-duotone` whose two colours come from tokens
  (`--background`, `--primary`) via `useThemeColors`; route/detour/pins are
  `.commute-*` classes (SVG attributes can't hold `var()`). Tilt mode (3D
  "data in space", default when `html[data-depth3d]`) lays the same map on a
  tilted plane; pins stand above it as HTML, positioned from invisible probe
  markers (`overflow:hidden` on Leaflet flattens 3D contexts).
- **My routes:** table `commute_routes` (per direction, ≤3 saved routes, each
  1–3 via points, one `is_default` enforced by a partial unique index).
  `buildCommute` computes saved routes with their own requests (TomTom gives no
  alternatives for waypoint routes) and the automatic fastest + alternatives
  WITHOUT via points, so user waypoints never distort the proposals;
  `options.ts` (`assembleOptions`, pure, tested) merges and de-duplicates them.
  `result.main` = the default route (saved ★, else automatic fastest) — brief,
  tile, dock and alerts read it, and detours are compared against it. The page
  lets you pick any option, set the default and edit routes on the map (click
  adds a via point, pins drag; map is forced flat while editing).
- **Config:** table `commute_settings` (exact home/work coordinates — the old
  `user_settings.home_lat/lon` stay ~1 km for weather), TomTom key in
  `user_secrets.tomtom_api_key` (Settings → Klucze API), UI in Settings →
  Dojazd. Defaults: leave 06:00, return 14:50.
- **Alerts:** `scripts/commute-watch.ts` + `commute-watch.yml`, started by
  pg_cron (`dispatch_commute_watch`) like the morning brief. One alert per
  direction per day unless the delay grew by 10+ min.
- **Quota:** keep TomTom calls cheap — queries refetch every 5 min only while
  the result is live, every 30 min for a planned departure.

## Design skills: project rules win

`.claude/skills/` holds third-party design skills (`design-taste-frontend`,
`high-end-visual-design`, `redesign-existing-projects`, installed via
`npx skills add Leonxlnx/taste-skill`, pinned in `skills-lock.json`). Use
them for taste — typography, spacing, motion, avoiding generic AI-looking
UI — but they are generic web guidance. Whenever a skill conflicts with
this file, **this file wins**: keep the J.A.R.V.I.S. HUD aesthetic and
colors from the theme tokens in `src/styles.css`, the `no-scrollbar` rule,
container-query panel layout, and scrollable pages. Don't swap in a
skill's suggested palette, fonts, or component library wholesale, and
don't add dependencies a skill recommends without asking.
