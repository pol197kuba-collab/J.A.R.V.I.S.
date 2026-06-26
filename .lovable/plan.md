
# Protocol: Ark Reboot

A self-contained, overlay-driven reboot sequence (~6s) that can be triggered three ways and runs through a single master controller. No existing route/transition logic is rewritten — the reboot temporarily overrides them.

## 1. State controller

**New file: `src/components/jarvis/ArkRebootContext.tsx`**

- React context exposing `{ isDiagnosticRunning, currentModule, currentLog, phase, startReboot() }`.
- Internal master timer (single `setTimeout` chain or `useRef` queue) drives:
  - **Phase 1 — Blackout (0–1500ms):** set `isDiagnosticRunning=true`, fire audio intro, speak intro line.
  - **Phase 2 — Module tour (1500–5700ms):** step through 6 modules every 700ms; on each step:
    1. `router.navigate({ to: <path> })` (bypasses HUD transition to keep cadence tight).
    2. Update `currentModule` + `currentLog`.
    3. Play `click-beep` and trigger a white/orange flash via a CSS class swap.
  - **Phase 3 — Stabilize (5700–7000ms):** navigate back to `/`, fade overlay out, speak final line, then `isDiagnosticRunning=false`.
- Re-entrancy guard: ignore `startReboot()` if already running.
- Provider mounted inside `DashboardShell` (only meaningful when `phase==="dashboard_active"`).

**Module sequence (matches sidebar order):**

```text
/             DASHBOARD     CORE REFRESHED // 100%
/agent-hub    AGENT HUB     RECONNECTING NEURAL AGENTS...
/sub-systems  SUB-SYSTEMS   COMPILING LOGISTICS UTILITIES...
/geo-tracking GEO-TRACKING  CALIBRATING SATELLITE LINKS...
/system-logs  SYSTEM LOGS   CLEARING BUFFER & STABILIZING...
/settings     SETTINGS      RESTORING USER PREFERENCES...
```

## 2. Overlay UI

**New file: `src/components/jarvis/ArkRebootOverlay.tsx`** (rendered once inside `DashboardShell`, above `<main>`, below header z-index of deactivate flash).

- Fixed full-screen layer, `pointer-events-none` while active to block stray clicks (`pointer-events-auto` on a transparent capture div).
- When `isDiagnosticRunning`:
  - Sibling `<main>` gets class `ark-dimmed` → `opacity: 0.05; filter: blur(2px);` via new CSS rule in `src/styles.css`.
  - Overlay renders an enlarged `ReactorCore` clone (scale 1.35) centered with intense amber glow (new `animate-ark-pulse` keyframe).
  - Above/around the core: streaming matrix-style log lines (`currentLog` plus a rolling tail of last 3) using existing mono font + amber color, with a fast horizontal "flyby" animation (`animate-log-streak`).
  - Module label in HUD tag style (`MODULE: AGENT HUB`).
  - Flash element with `animate-ark-flash` retriggered per step via key.

**CSS additions in `src/styles.css`:**
- `.ark-dimmed { transition: opacity 400ms, filter 400ms; opacity: .05; filter: blur(2px); pointer-events: none; }`
- `@keyframes ark-pulse` (scale + amber drop-shadow throb).
- `@keyframes ark-flash` (180ms white→amber fade).
- `@keyframes log-streak` (translateX -120% → 120%).

## 3. Audio

**New file: `src/lib/audio/arkReboot.ts`**
- `playRebootIntro()`: Web Audio API oscillator sweep 40Hz → 180Hz over ~1.2s with gain envelope (uses existing `audio` engine's `AudioContext` via a new `getCtx()` accessor on `AudioEngine`).
- `playClickBeep()`: short 880Hz square blip, 60ms. (If `audio.playClick()` already exists this can wrap it with a higher-pitched variant.)
- Uses `speak()` from `src/lib/audio/speak.ts` for both narration lines (queued, so they don't clip).

## 4. Trigger #1 — Header button

**Edit: `src/components/jarvis/DashboardShell.tsx`**
- Add new `<RebootButton />` in the header right cluster, between `HeaderVoiceToggle` and `FullscreenToggle`.
- Lucide `Zap` icon + label `REBOOT SYSTEM`, same neon-cyan border styling as `HudMenuTrigger`.
- `onClick={() => { audio.playClick(); startReboot(); }}` from `useArkReboot()`.
- Disabled while `isDiagnosticRunning`.

## 5. Trigger #2 — Chat / Trigger #3 — Voice

**New file: `src/lib/ai/rebootPhrases.ts`**
- Exports `REBOOT_PHRASE_RE = /\b(reboot system|restart system|zrestartuj system|ark reboot|reboot|restart|reset)\b/i`.
- Exports `matchesReboot(text: string): boolean`.

**Edit: `src/components/jarvis/VoiceCommandContext.tsx`** and **`src/components/jarvis/ChatPanel.tsx`**
- Before dispatching to Gemini (`askJarvis`), run `matchesReboot(cleanText)`. If true:
  - Push the user line + a synthetic JARVIS reply (`"Acknowledged. Engaging Protocol: Ark Reboot."`) into `chatBus`.
  - Call `startReboot()` and `return` — skip Gemini call entirely (local safety-net, no quota usage).
- For chat the phrase is matched without the `jarvis` wake-word requirement.
- For voice it runs **after** wake-word stripping, so "Jarvis, reboot" works.

**Edit: `src/lib/ai/jarvisBrain.ts`**
- Extend system prompt's allowed-action list with `"reboot"` and document the trigger phrases so Gemini also returns `{ action: "reboot", speech: "..." }` for paraphrases.
- Add `"reboot"` to `JarvisAction` union.

**Edit: action dispatcher** (wherever `JarvisAction` is currently switched — likely `VoiceCommandContext` and/or a shared `runAction.ts`)
- Case `"reboot"` → `startReboot()`.

**Edit: `src/data/commandDirectory.ts`**
- Add a `reboot` entry under category `"System"` with the phrase list, so it appears in the in-app Command Directory.

## 6. Interaction with existing systems

- `HudRouteTransition` is skipped during reboot (we navigate with `router.navigate` directly, not `useHudNavigate`).
- Sidebar nav items are disabled during reboot (read `isDiagnosticRunning` in `AppSidebar.tsx` and add `pointer-events-none opacity-50` on the nav list).
- `DeactivateButton`, `HeaderVoiceToggle`, `FullscreenToggle`, `RebootButton`: all set `disabled={isDiagnosticRunning}`.
- After phase 3, router lands back on `/` and normal `HudRouteTransition` resumes for subsequent user navigation.

## 7. File summary

New:
- `src/components/jarvis/ArkRebootContext.tsx`
- `src/components/jarvis/ArkRebootOverlay.tsx`
- `src/components/jarvis/RebootButton.tsx`
- `src/lib/audio/arkReboot.ts`
- `src/lib/ai/rebootPhrases.ts`

Edited:
- `src/components/jarvis/DashboardShell.tsx` (provider + overlay + button)
- `src/components/jarvis/AppSidebar.tsx` (disable nav during reboot)
- `src/components/jarvis/ChatPanel.tsx` (local reboot intercept)
- `src/components/jarvis/VoiceCommandContext.tsx` (local reboot intercept + action case)
- `src/lib/ai/jarvisBrain.ts` (add `reboot` action + prompt phrasing)
- `src/data/commandDirectory.ts` (add entry)
- `src/styles.css` (ark-dimmed, ark-pulse, ark-flash, log-streak keyframes)

No existing route files, transition logic, or Gemini history handling change behavior outside the reboot window.
