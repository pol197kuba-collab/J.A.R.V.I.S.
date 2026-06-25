# Moduł SUB-SYSTEMS — plan implementacji

Dodaję nową zakładkę „SUB-SYSTEMS" jako portal kontenerowy dla 3 zewnętrznych aplikacji, w pełni spójny ze stylistyką Stark HUD intra. Wszystko w jednym SPA, bez przeładowań.

## 1. Nowa trasa i nawigacja

- `src/routes/sub-systems.tsx` — nowa trasa `/sub-systems` (TanStack file-route).
- `src/components/jarvis/AppSidebar.tsx` — dodaję pozycję „SUB-SYSTEMS" z ikoną `Boxes` (lucide, `strokeWidth={1.5}`, neon cyan), używającą istniejącego `useHudNavigate` (re-używa systemu przejść HUD między zakładkami).

## 2. State machine portalu (lokalny w trasie)

W `sub-systems.tsx` lokalny stan: `'grid' | 'loading' | 'active' | 'terminating'` + `activeModule: ModuleId | null`. Brak ingerencji w globalny `PhaseContext`.

Flow:
```text
grid --[INITIALIZE]--> loading (4.5s) --> active (iframe + top bar)
active --[TERMINATE]--> terminating (CRT off, ~700ms) --> grid
```

Lista modułów (placeholder URL — user podmieni):
- `fuel-monitor` — „FUEL MONITOR" — Fuel surcharge monitoring & logistics analytics — `https://example.com/fuel-monitor`
- `rto-calculator` — „RTO CALCULATOR" — Return To Office financial & commute impact calculator — `https://example.com/rto-calculator`
- `jobfit-ai` — „JOBFIT AI" — AI-powered CV optimization & job advertisement matching platform — `https://example.com/jobfit-ai`

Konfiguracja w `src/data/subSystems.ts` (id, name, description, url, sysRef, ikona) — łatwa do podmiany URL-i.

## 3. Komponenty (nowe pliki w `src/components/jarvis/subsystems/`)

- `SubSystemGrid.tsx` — siatka 3 kafelków na `HudPanel` (`grid-cols-1 md:grid-cols-3`). Każdy kafelek: nazwa (font-display), opis (mono), mikroteksty w narożnikach (`HudTag` + losowy `SYS_REF`), pulsujący przycisk „INITIALIZE MODULE" (animowana neon obwódka + audio click przy hover/click). Wejście kafelków staggered (re-używam `animate-hud-tile-in`).
- `ModuleLoader.tsx` — pełnoekranowy overlay (4.5s):
  - centralny obracający się radar HUD (SVG: 3 koncentryczne pierścienie z `spin-cw`/`spin-ccw`, wiązka skanująca z `conic-gradient` + maska, podpis „DECRYPTING LINK // EXTERNAL_SERVER_CONNECT").
  - pasek postępu skokowy (steps `[8, 23, 41, 58, 72, 88, 96, 100]` w czasie 4.5s przez `setInterval`).
  - boczny log linii kodu (auto-scroll, monospace, cyjan): „INITIATING HANDSHAKE...", „CONNECTING TO {MODULE}.SYS...", „BYPASSING FIREWALL...", „NEGOTIATING TLS 1.3...", „STARK_SECURE_TUNNEL: ACTIVE", „MOUNTING REMOTE DOM..." (dodawane stopniowo).
  - audio: `audio.playEngage()` na start, `audio.playAccessGranted()` na 100%.
  - zakończenie: `iris-open` (re-używam istniejącej keyframe) → callback `onReady()`.
- `ModuleFrame.tsx` — kontener aktywnego iframe:
  - górny pasek HUD (sticky, `h-9`, cienka ramka, neon glow): mini Arc Reactor + „MODULE HOSTED VIA STARK_OS_V3 // SECURE TERMINAL // {MODULE_NAME}" po lewej, status „LINK: STABLE" (zielona blink-dot) w środku, czerwony przycisk „TERMINATE PROCESS // EXIT" po prawej (styl z `DeactivateButton`, kolor `--destructive`).
  - `<iframe src={url} className="w-full h-[calc(100%-2.25rem)]" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />` z `title={name}`.
  - animacja wejścia: `animate-hud-tile-in` na całym kontenerze po `iris-open`.
- `CrtShutdown.tsx` — overlay zamykający (700ms): efekt starego CRT — skala Y → 0.02 (pozioma linia), potem skala X → 0 (punkt), potem fade-out punktu. CSS keyframe `crt-off` zdefiniowany w `styles.css`.

## 4. Animacje (dodaję do `src/styles.css`)

```text
@keyframes crt-off { ... 0%→full, 55%→scaleY(0.02), 80%→scaleX(0.005), 100%→opacity 0 }
@keyframes radar-sweep { conic rotate 0→360 }
@keyframes init-pulse { box-shadow + opacity pulse dla przycisku INITIALIZE }
@keyframes log-line-in { translateY(4px)+opacity 0→1 }
```
Plus mała klasa `.crt-frame` z `transform-origin:center` i `will-change:transform,opacity`.

## 5. Spójność wizualna

- Wszystko owinięte w `HudPanel` z istniejącymi `hud-corner` + `HudTag` (mikroteksty `SYS_REF`, `CH_`, itp. — istniejący generator).
- Typografia mono (już globalnie), akcent `var(--primary)` (neon cyjan), destructive dla TERMINATE.
- Ostre rogi (`rounded-none`), cienkie ramki 1px, neon drop-shadow.

## 6. Audio (re-use `audio` engine)

- `audio.playClick()` — hover/click na kafelku i TERMINATE.
- `audio.playEngage()` — start ModuleLoader.
- `audio.playAccessGranted()` — na 100% progressu.
- `audio.playShutdown()` — przy TERMINATE (krótki sweep — re-use).

## 7. Blokady / UX

- Podczas `loading` i `terminating` interakcje wyłączone (`pointer-events-none` na siatce; overlay przykrywa wszystko).
- Iframe ma `loading="lazy"` i `referrerPolicy="no-referrer"`. Sandbox flags konserwatywne, można poszerzyć per moduł później.
- Brak hard-coded kolorów — wszystko przez tokeny w `styles.css`.

## 8. Pliki

**Nowe:**
- `src/routes/sub-systems.tsx`
- `src/data/subSystems.ts`
- `src/components/jarvis/subsystems/SubSystemGrid.tsx`
- `src/components/jarvis/subsystems/ModuleLoader.tsx`
- `src/components/jarvis/subsystems/ModuleFrame.tsx`
- `src/components/jarvis/subsystems/CrtShutdown.tsx`

**Modyfikowane:**
- `src/components/jarvis/AppSidebar.tsx` — pozycja menu „SUB-SYSTEMS".
- `src/styles.css` — keyframes `crt-off`, `radar-sweep`, `init-pulse`, `log-line-in`.

## Co NIE zmieniam

Boot/Login flow, ReactorCore, istniejące zakładki, audio engine, system przejść HUD — bez zmian. Routing istniejących tras nietknięty.
