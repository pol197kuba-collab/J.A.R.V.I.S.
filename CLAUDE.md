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
