## Goal
Add mobile drawer sidebar + auto-fullscreen on Engage, without breaking the 3D core or landscape layout.

## 1. Mobile Drawer Sidebar
- Edit `src/components/jarvis/AppSidebar.tsx`: keep current `Sidebar` for desktop. The shadcn `Sidebar` already swaps to a `Sheet` on mobile (`useIsMobile`), so the sidebar markup itself doesn't change — but we currently rely on the header `SidebarTrigger` which is small/plain.
- Edit `src/routes/__root.tsx` header: replace the default `SidebarTrigger` on mobile/landscape with a custom HUD button — cyan glow, sharp corners, label "MENU // SYS" + hamburger icon (lucide `Menu`). On desktop keep the current trigger. The button calls `setOpenMobile(true)` from `useSidebar()`.
- Style the mobile `Sheet` variant of `Sidebar` (in `src/components/ui/sidebar.tsx` SheetContent for `data-mobile="true"`): override background to `bg-black/85 backdrop-blur`, add neon cyan border (`border-primary/60`), shadow glow, sharp corners. Add a visible HUD-styled close "X" button at top-right inside the sheet (shadcn Sheet ships a default close, but restyle/replace to match HUD: cyan ring, "[ X ] CLOSE").
- Verify `SidebarMenuButton` still works inside the sheet and that `useHudNavigate` auto-closes the sheet after click (call `setOpenMobile(false)` after `go(...)`).

## 2. Auto Fullscreen on Engage
- New helper `src/lib/fullscreen.ts`: `requestAppFullscreen()` tries `el.requestFullscreen()`, then `webkitRequestFullscreen`, then `webkitEnterFullscreen` on a fallback `<video>` (iOS Safari has no real element fullscreen — gracefully no-op there). Wrap in try/catch; never throw.
- `src/components/jarvis/BootSequence.tsx` (engage mode): in the Engage button click handler, call `requestAppFullscreen()` before `onEngage()`. User-gesture requirement is satisfied because it's a click handler.
- `src/routes/__root.tsx` header: add a small HUD icon button (lucide `Maximize2`) next to `DeactivateButton` that toggles fullscreen on demand for desktop / re-entry on mobile if user exited.
- Listen to `fullscreenchange` to update the toggle icon (`Minimize2` when active).

## 3. Layout integrity in fullscreen
- `src/routes/__root.tsx` already uses `landscape:max-md:h-screen overflow-hidden` — verify it still fills correctly when `100vh` expands after browser chrome hides. Use `100dvh` via Tailwind arbitrary (`h-[100dvh]`) for the landscape mobile shell so the layout re-flows when chrome hides.
- `ReactorCore` is sized by its parent (`max-w-[140px]` in landscape mobile). No change needed — it scales with the container, so fullscreen just gives more breathing room.

## Files touched
- `src/routes/__root.tsx` — custom mobile HUD menu button, fullscreen toggle icon, `100dvh` for mobile landscape shell.
- `src/components/jarvis/AppSidebar.tsx` — auto-close mobile sheet after nav.
- `src/components/ui/sidebar.tsx` — restyle the mobile Sheet variant (HUD frame + close button).
- `src/components/jarvis/BootSequence.tsx` — call `requestAppFullscreen()` on Engage click.
- `src/lib/fullscreen.ts` — new helper with vendor prefixes.

## Out of scope
No changes to phase state machine, audio engine, 3D core internals, or voice commands.
