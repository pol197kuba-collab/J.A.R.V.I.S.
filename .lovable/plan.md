## Vision — pełna obsługa pionu + kontrolki kamery

Cel: strona `/vision` działa i w pionie, i w poziomie na telefonie. Reszta aplikacji pozostaje bez zmian (dalej tylko poziomo).

### 1) `src/components/jarvis/OrientationGate.tsx`

- Dodaje prop `exemptPaths?: string[]` (domyślnie `[]`).
- Śledzi aktualny pathname reaktywnie przez `useRouterState({ select: s => s.location.pathname })` z `@tanstack/react-router` (natywny, wspierany sposób; brak monkey‑patchowania `history`).
- Efektywne blokowanie: `blocked && !exemptPaths.some(p => pathname === p || pathname.startsWith(p + "/"))`.
- Gdy ścieżka jest wyjęta — renderuje `children` bez overlayów, nawet w portrait. Przy nawigacji poza `/vision` w portrait gate aktywuje się z powrotem (bo pathname się zmieni).
- Zero zmian w istniejącym UI komunikatu portrait.

### 2) `src/components/jarvis/PhaseController.tsx`

- Jedyna zmiana: `<OrientationGate exemptPaths={["/vision"]}>`.

### 3) `src/routes/vision.tsx`

- Bez zmian funkcjonalnych; upewniam się, że `VisionPage` zajmuje pełną wysokość viewportu (`min-h-[100dvh]`) i nie ma outer paddingu, żeby portrait się mieścił.

### 4) `src/components/jarvis/VisionScanner.tsx` — nowe funkcje

**Responsywność (portrait + landscape):**
- Kontener zewnętrzny: `flex flex-col min-h-0` w portrait; landscape zostaje jak dziś (`landscape:` warianty nietknięte, tylko dokładam różnice dla portrait).
- Ramka kamery: portrait → `aspect-[3/4] max-h-[70dvh]`; landscape → obecne `landscape:max-md:aspect-video landscape:max-md:max-h-[62vh]`.
- HUD panel + SCAN w portrait: `flex-col` z `overflow-hidden`, przycisk w sticky pasku na dole panelu, `shrink-0`.
- Sidebar: nic nie zmieniam w `AppSidebar.tsx` — `SidebarProvider` już zwija do hamburgera na `isMobile`, więc portrait telefonu obsłuży się sam.

**Przełącznik kamer (multi‑lens):**
- Po pierwszym streamie: `navigator.mediaDevices.enumerateDevices()` → filtr `kind === "videoinput"`.
- Stan `devices: MediaDeviceInfo[]` + `activeDeviceId`.
- Rebuild streamu: `getUserMedia({ video: { deviceId: { exact: id } } })` — stopuję poprzednie tracki, podpinam nowy stream. Guard przeciw równoległym startom.
- UI: przycisk „LENS” (`SwitchCamera`) obok SCAN, cyklicznie przełącza obiektywy. Aktywny obiektyw pokazany w HUD (`LENS N/M`), z fallbackiem nazw gdy `label` puste.
- Fallback dla iOS gdy `enumerateDevices` zwraca 1 wpis: toggle przez `facingMode: "user" | "environment"`.

**Zoom (płynny):**
- Po starcie: `track.getCapabilities()`. Jeśli `capabilities.zoom` (`min/max/step`) — pionowy suwak HUD z prawej strony ramki; `applyConstraints({ advanced: [{ zoom }] })`.
- Fallback: CSS `transform: scale(z)` na `<video>` (1×–3×) z oznaczeniem „DIGITAL”. Suwak zawsze widoczny dla spójnego UX.
- Podwójny tap = reset do 1×.

**Tap‑to‑focus:**
- Tap na ramce → znormalizowane `x,y`.
- Jeśli `capabilities.focusMode` wspiera `manual`/`single-shot` i `pointsOfInterest` istnieje: `applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }], focusMode: "single-shot" }] })`.
- Zawsze rysuję animowany „focus reticle” (~600 ms) w miejscu tapu — feedback wizualny nawet bez API.
- Long‑press (~600 ms) = AE/AF lock: `focusMode: "manual"` jeśli wspierane; inaczej HUD‑toast „AF LOCK N/A”.

**Cleanup / edge cases:**
- Przy zmianie obiektywu/unmount stopuję tracki, zeruję `srcObject`.
- `visibilitychange → hidden` = pauza; powrót = restart (iOS).
- SCAN/LENS/zoom `disabled` gdy `state !== "ready"`.
- Zero nowych zależności npm.

### 5) Czego NIE zmieniam

- `BootSequence.tsx`, `PhaseContext.tsx`, żaden inny route poza `vision.tsx`.
- `AppSidebar.tsx`, `HudPanel.tsx` — bez zmian.
- Globalne style w `styles.css` — ewentualnie dorzucam mały keyframe focus reticle jeśli `animate-ping` nie wystarczy.
- `runtime.server.ts`, `runtime.functions.ts`, `persona.ts`, `jarvisBrain.ts`.

### Ryzyka

- iOS Safari: `zoom`/`pointsOfInterest` bywają nieobsługiwane — pokryte fallbackami.
- `enumerateDevices` na iOS często raportuje 1 kamerę na stronę mimo multi‑lens — pokryte `facingMode` toggle.
- Wszystko scope’owane do `/vision`; reszta appki nadal wymusza landscape przez `OrientationGate`.
