## JARVIS — Advanced Gadgets & Modules

Five new HUD modules integrated with the existing phase/transition system, optimized for landscape mobile and decoupled from the 3D core's render loop.

---

### 1. Audio Spectrum Visualizer (around ARC CORE)

- New component `CoreAudioSpectrum.tsx` rendered as an absolutely-positioned `<canvas>` layer inside `ReactorCore.tsx`, sitting *outside* the gyroscope's `preserve-3d` subtree so it never triggers 3D relayout.
- Uses a shared `AnalyserNode` (extend `AudioEngine.ts` with `getAnalyser()` so mic + visualizer share one node — no double `getUserMedia`).
- Draws 64 radial bars (neon cyan) on a circular path around the amber core; bar heights from `getByteFrequencyData()`. Idle state: gentle sine pulse so it's never visually dead.
- Single rAF loop, writes to canvas only (no React state). Auto-pauses via `IntersectionObserver` and when `prefers-reduced-motion`.

### 2. Vocal Override (continuous Web Speech Recognition)

- New `VoiceCommandContext.tsx` provider mounted in `__root.tsx` (only active when `phase === 'dashboard_active'`).
- Wraps `webkitSpeechRecognition` with auto-restart on `end`/`error`, language `en-US`, `continuous: true`, `interimResults: true`.
- Switch UI: `VocalOverrideSwitch.tsx` placed in `ChatPanel` header — label "VOCAL OVERRIDE // CONTINUOUS LISTEN" with ACTIVE/INACTIVE state, pulsing cyan dot when listening.
- Pattern matcher (case-insensitive, regex on final transcript):

  ```text
  /jarvis dashboard|show core/   → navigate "/"
  /jarvis fuel|open fuel/        → navigate "/sub-systems" + auto-init fuel-monitor
  /jarvis office|open calculator/→ navigate "/sub-systems" + auto-init rto-calculator
  /jarvis job|open jobfit/       → navigate "/sub-systems" + auto-init jobfit-ai
  /jarvis system shutdown|disconnect/ → trigger shutdown phase
  ```

- Auto-init handoff: `sub-systems.tsx` reads a `?init=<id>` search param (or a small `pendingModule` ref in context) and jumps straight to the loader sequence.
- Uses existing `useHudNavigate` so transitions stay coherent. Falls back gracefully if `SpeechRecognition` unsupported (switch disabled with tooltip).

### 3. Weather Telemetry Grid widget

- New `WeatherTelemetry.tsx` on the dashboard (compact HUD panel, sharp corners, neon border).
- Mock data (slowly jittered every 4s via `setInterval` for liveness): `THERMAL_INDEX`, `ATMOSPHERIC_PRESSURE`, `WIND_VECTOR`, `HUMIDITY`, plus `VISIBILITY` and `UV_INDEX` for density.
- Right side: small SVG radar — concentric rings + rotating green-cyan sweep wedge (new `@keyframes radar-sweep-weather` reuses pattern from sub-systems radar, color shifted to green).

### 4. Global Threat Stream widget

- New `ThreatStream.tsx` — vertical auto-scrolling list (CSS `marquee` via `transform: translateY` + `animation`, pauses on hover).
- Mock feed of ~12 entries with severity tag color (`ALERT` orange, `DATA` cyan, `WARNING` amber-red), timestamp, payload text. Severity left-border accent.
- New entry pushed every ~6s (shift array, cap length 20) so the feed feels live.

### 5. GEO-TRACKING route

- New route `src/routes/geo-tracking.tsx` + sidebar entry in `AppSidebar.tsx` (icon: `Satellite` or `Crosshair` from lucide).
- `bun add leaflet @types/leaflet` + `@import "leaflet/dist/leaflet.css"` at the top of `src/styles.css`.
- Dark map: use CartoDB **dark_nolabels** tiles (no key required), apply CSS filter `invert(0) hue-rotate(180deg) saturate(2) brightness(0.6)` on `.leaflet-tile` to push it toward cyan/black.
- Centered crosshair overlay (pure CSS/SVG, not a Leaflet marker — anchored to map container center so it stays fixed during pan).
- Uses `navigator.geolocation.getCurrentPosition` to set initial view; on denial, fallback coords (Warsaw) + label `SIGNATURE_LOST // DEFAULT GRID`.
- Caption bar: `HOST SIGNATURE PINPOINTED // LAT: xx.xxxx LON: xx.xxxx`, plus mock telemetry rows (accuracy, altitude, heading).

---

### Dashboard layout (landscape mobile fit)

Reflow `src/routes/index.tsx` to a 3-column landscape grid so the new widgets fit without scrolling:

```text
┌──────────┬─────────────┬───────────────┐
│ Active   │  ARC CORE   │ Weather       │
│ Tasks    │  + spectrum │ Threat Stream │
├──────────┴─────────────┴───────────────┤
│ Chat (+ Vocal Override switch)         │
└────────────────────────────────────────┘
```

Desktop keeps roomier 2-col layout. All new panels use existing `HudPanel` styling.

---

### Performance guardrails

- Single shared `AnalyserNode` for mic (visualizer + existing `useMicAnalyser` both read from it).
- Canvas drawing for the spectrum (no SVG/DOM bars), `willReadFrequently: false`, fixed DPR cap of 1.5.
- Speech recognition lives outside React render path; only the switch state is reactive.
- Threat stream uses CSS animation, not JS rAF.
- Leaflet only loaded on `/geo-tracking` (lazy via route boundary).

---

### Files

**New:** `CoreAudioSpectrum.tsx`, `VoiceCommandContext.tsx`, `VocalOverrideSwitch.tsx`, `WeatherTelemetry.tsx`, `ThreatStream.tsx`, `src/routes/geo-tracking.tsx`, `src/data/threatStream.ts`.

**Edited:** `ReactorCore.tsx` (mount spectrum), `AudioEngine.ts` (shared analyser), `useMicAnalyser.ts` (consume shared analyser), `ChatPanel.tsx` (switch), `routes/index.tsx` (layout + new widgets), `routes/__root.tsx` (provider), `routes/sub-systems.tsx` (auto-init from voice), `AppSidebar.tsx` (Geo-Tracking link), `styles.css` (radar-sweep-weather, threat-marquee, leaflet dark filter), `package.json` (leaflet).
