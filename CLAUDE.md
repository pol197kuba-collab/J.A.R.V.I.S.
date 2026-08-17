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
