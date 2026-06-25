# Plan: Wydajność 3D + Audio JARVIS

## 1. Optymalizacja wydajności rdzenia (`src/components/jarvis/ReactorCore.tsx`)

**Problemy obecne:**
- 26 cząsteczek = 26 osobnych elementów DOM z własnymi animacjami
- `useCoord` i `useAudioLevel` aktualizują state co ~50–100 ms → React re-renderuje całe drzewo rdzenia
- `mix-blend-mode: screen` + `drop-shadow` na 6 warstwach = kosztowny composite
- `gyro-tilt` animuje cały kontener `transform`, wymuszając repaint warstw potomnych

**Zmiany:**
- Zastąpić chmurę cząsteczek **jednym `<canvas>` 2D** (rysowanym w `requestAnimationFrame`) — 1 element DOM zamiast 26.
- Zamienić `useCoord` (setState) na **bezpośrednią mutację `ref.current.textContent`** w rAF — zero re-renderów React.
- Audio level również propagowany przez CSS custom property (`element.style.setProperty('--audio', val)`) zamiast props/state → re-render tylko warstwy CSS, nie React.
- Każda warstwa SVG dostaje `will-change: transform` i `contain: layout paint`.
- Ograniczyć `drop-shadow` do 2 najjaśniejszych warstw (zewnętrznej i wewnętrznej) zamiast wszystkich 6.
- `gyro-tilt` przeniesiony na osobny wrapper z `transform: translateZ(0)` (warstwa GPU) i animowany via CSS, nie JS.
- Hook `useAudioLevel` (symulowany) zastąpiony realnym `AnalyserNode` (patrz sekcja Audio) — odpalany tylko gdy `active=true`.

## 2. System audio (`src/lib/audio/`)

Nowy moduł oparty wyłącznie na **Web Audio API** (bez plików):

**`src/lib/audio/AudioEngine.ts`** — singleton:
- `AudioContext` tworzony leniwie przy pierwszej interakcji (gesture requirement).
- Master `GainNode` + master volume w Settings.
- Metody: `playBoot()`, `playClick()`, `playEngage()`, `playAccessGranted()`, `playAccessDenied()`, `playShutdown()`, `startHum()`, `stopHum()`, `playBeep()`.

**Brzmienia (syntetyczne):**
- **Hum reaktora** — 2 osciliatory (60 Hz sine + 120 Hz triangle) przez lowpass + lekki LFO modulujący gain → ciągły, niski pomruk podczas `dashboard_active`.
- **Click** — krótki noise burst (200 ms) przez bandpass 2 kHz, attack 1 ms / decay 60 ms. Wywoływany przy nawigacji w sidebarze.
- **Engage** — sweep oscylatora 80 → 800 Hz przez 1.2 s + szum białego, lowpass otwierający się równolegle.
- **Access Granted** — dwa beepy 880 Hz → 1320 Hz, każdy 80 ms.
- **Access Denied** — trzy szybkie beepy 220 Hz square + lekki distortion.
- **Shutdown** — odwrotny sweep 800 → 40 Hz + zanikający szum, 2.5 s.

**`src/lib/audio/useMicAnalyser.ts`** — hook:
- `getUserMedia({ audio: true })` przy `active=true`.
- `AnalyserNode` z `fftSize: 256`, odczyt RMS w rAF.
- Wartość zapisywana do przekazanego `ref` (nie state) → komponent ustawia `--audio` CSS var w tym samym rAF.
- Cleanup: stop tracks + close context branch przy `active=false` lub unmount.
- Graceful fallback: jeśli użytkownik odmówi mikrofonu → cichy log, rdzeń pulsuje base rate.

## 3. Integracja z istniejącym flow

- `BootSequence` (engage) → `playBoot()` przy starcie, `playEngage()` na klik.
- `StarkLogin` → `playClick()` na inputach, `playAccessGranted()` / `playAccessDenied()` po walidacji.
- `BootSequence` (init) → niski sweep w tle.
- `dashboard_active` → `startHum()`; `shutdown` → `stopHum()` + `playShutdown()`.
- `AppSidebar` nawigacja → `playClick()`.
- `VoiceButton` aktywacja → `playBeep()` + start `useMicAnalyser`.

## 4. UI: Settings → Audio

Dodać w `src/routes/settings.tsx` panel HUD z:
- Master volume (slider 0–100).
- Toggle "Ambient Hum".
- Toggle "UI Sounds".
- Info: "Microphone access requested on first voice activation."

Preferencje trzymane w `localStorage` pod kluczem `jarvis.audio` i czytane przez `AudioEngine`.

## 5. Co NIE zmieniam

- Wygląd wizualny rdzenia, palety, animacje przejść HUD, struktura faz, dashboard layout, mock data — bez zmian.
- Reduced motion — pomijam zgodnie z odpowiedzią.

## Pliki
- **Nowe:** `src/lib/audio/AudioEngine.ts`, `src/lib/audio/useMicAnalyser.ts`, `src/lib/audio/useAudioSettings.ts`
- **Modyfikowane:** `ReactorCore.tsx` (canvas particles + refs + real mic), `BootSequence.tsx`, `StarkLogin.tsx`, `AppSidebar.tsx`, `VoiceButton.tsx`, `routes/__root.tsx` (hum lifecycle), `routes/settings.tsx` (panel audio), `styles.css` (drobne `will-change`/`contain`).
