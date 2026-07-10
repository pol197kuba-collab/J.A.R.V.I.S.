## Vision — 4 poprawki po testach na S25 Ultra

Zakres: `public/manifest.json` i `src/components/jarvis/VisionScanner.tsx`. Nic więcej.

### 1) `public/manifest.json`

- `"orientation": "landscape"` → `"orientation": "any"`.
- `OrientationGate` (z `exemptPaths=["/vision"]`) dalej pilnuje UX — reszta appki pozostaje pozioma bez zmian.

### 2) VisionScanner — baseline zoomu

- Po starcie streamu, gdy `caps.zoom` i `caps.zoom.max > caps.zoom.min`:
  - odczytaj `const cur = track.getSettings?.().zoom`,
  - jeśli `typeof cur === "number"` i mieści się w `[min,max]` → użyj `cur` jako baseline,
  - w przeciwnym razie fallback: `caps.zoom.min`.
- Zapisuj `zoomCaps = { min, max, step }` jak dziś.

### 3) VisionScanner — kierunek suwaka (frakcja 0–1)

- Zastąp stan `zoom: number` stanem `zoomFraction: number` (0..1). `0` = najszerszy kadr z perspektywy usera, `1` = maks. przybliżenie.
- Domyślne mapowanie (test na S25 Ultra pokazał, że rosnąca surowa wartość `zoom` ODDALA):
  ```
  rawZoom = lerp(caps.zoom.max, caps.zoom.min, zoomFraction)
  // fraction 0 → max (najszerszy user-side)
  // fraction 1 → min (max przybliżenie user-side)
  ```
- Baseline z pkt 2 tłumaczymy z powrotem na frakcję i ustawiamy jako start:
  `zoomFraction = (max − cur) / (max − min)`.
- Efekt `applyConstraints`: przelicza `rawZoom` z `zoomFraction` przy każdej zmianie.
- Slider / przyciski:
  - `input[type=range]` → `min=0 max=1 step=0.01` na `zoomFraction`.
  - `Plus` → `+0.1` (clamp), user-side „bliżej”.
  - `Minus` → `−0.1`, „dalej”.
  - Double-tap → `zoomFraction` = frakcja z baseline (nie sztywne 0).
- Fallback bez `caps.zoom` (CSS `transform: scale`): `zoomFraction` mapuje na `1×–3×`, ta sama logika UI.
- HUD `ZOOM x.x×`: kosmetyczny przelicznik z `zoomFraction` (hardware: `1× → maxDisplay = round(max/baseline)`, digital: `1×–3×`).

### 4) VisionScanner — rozdzielenie sterowania obiektywami

Usuń przycisk „LENS” i `cycleLens`. Wprowadź dwa:

**FLIP** (`SwitchCamera`, zawsze widoczny):
- Przełącza wyłącznie `facingMode` między `"environment"` a `"user"`.
- `start({ facingMode: next })`, `setFacingMode(next)`, zamknij popover, wyczyść `activeDeviceId` do momentu odczytu nowego.

**LENSES** (`Aperture`, widoczny tylko gdy `facingMode === "environment"` ORAZ `rearDevices.length > 1`):

- Klasyfikacja — case-insensitive, bazujące na jednorazowym `label.toLowerCase()`:
  ```
  const l = (d.label ?? "").toLowerCase();
  const isFront = /front|user/.test(l);
  ```
  (regex bez flagi `/i`, bo już testujemy na zlowercase'owanym stringu). `frontDevices` i `rearDevices` na tej podstawie.
- Klik otwiera popover-HUD nad przyciskiem: opcje ułożone łukowo (pół-koło otwarte w dół, promień ~64–80 px, pozycja `transform: translate(cos*r, sin*r)`), każda opcja to okrągły guzik z 3-znakową etykietą.
- Etykieta z `label`, również na zlowercase'owanym stringu — dopasowanie po kolei do `ultra`, `wide`, `tele`, `macro` (regex bez `/i`, bo `l` już lowercase). Fallback: `L1`, `L2`, `L3`… (indeks w `rearDevices`).
- Wybór: `start({ deviceId })`, `setActiveDeviceId`, zamknij popover.
- Aktywny obiektyw podświetlony ramką `--primary` + `boxShadow: var(--glow-primary)`.
- Popover zamyka się po kliknięciu poza (globalny `pointerdown` z guardem na kontener).

**HUD `LENS ...`:**
- `facingMode === "user"` → `LENS FRONT`.
- `environment` + wiele tylnych → `LENS <etykieta>` lub `N/M`.
- `environment` + jeden → `LENS BACK`.

### Ograniczenia

- Puste `label` (iOS Safari, brak grantów) → same fallbacki `L1..Ln`; `LENSES` się nie pojawi, jeśli `rearDevices.length ≤ 1`. Akceptowane.
- Kierunek mapowania zoomu weryfikowany na urządzeniu; odwrócenie to jedna zmiana `lerp`.

### Poza zakresem

- `BootSequence`, `PhaseContext`, `AppSidebar`, `HudPanel`, `OrientationGate`, `PhaseController`, inne route’y, pliki agentowe, `styles.css`, migracje, sekrety, zależności npm — bez zmian.
