## Cel
Przebudować mechanikę uruchamiania aplikacji JARVIS w jeden płynny SPA flow oparty na maszynie stanów, bez przeładowań strony, z 4 fazami: bootowanie → logowanie → transformacja → dashboard, plus shutdown wracający do startu.

## Architektura stanów

Wprowadzić jeden centralny stan w `src/routes/__root.tsx`:

```ts
type AppPhase =
  | 'booting'              // 0–15s, 3 sekwencje animacji
  | 'login_screen'         // formularz Stark Industries
  | 'transition_to_dashboard' // rozpad loginu + budowa kafelków
  | 'dashboard_active'     // pełny dashboard + przycisk DEACTIVATE
  | 'shutdown';            // wygaszanie kafelków → powrót do 'booting'
```

Wszystko renderowane warunkowo w jednym drzewie, z `AnimatePresence`-podobną logiką opartą na czystym CSS (klasy `data-phase`, keyframes wejścia/wyjścia). Brak `<Outlet />` dopóki `dashboard_active`.

## Faza 1 — Bootowanie (≈15s, 3 podsekwencje)

Nowy komponent `src/components/jarvis/BootSequence.tsx` z lokalnym podstanem `bootStep: 1 | 2 | 3` sterowanym `setTimeout` (5s + 5s + ~5s, czyszczone w cleanupie).

- **Seq 1 (0–5s)**: czarne tło, animowane poziome neonowe linie (gradient + `line-trace` keyframe), pasek postępu z napisem `INITIATING SYSTEM 1...`, w tle przewijające się pseudo-logi (IP, protokoły) — generowane z `mock.ts` (nowe dane `bootLogs`).
- **Seq 2 (5–10s)**: linie znikają (fade-out), pojawiają się 3 wirujące w przeciwnych kierunkach okręgi SVG (HUD), w centrum litera po literze typuje się `J.A.R.V.I.S.` (state index znaku, interval 200ms).
- **Seq 3 (10–15s)**: okręgi przechodzą w pulsujący trójkątny reaktor łukowy (nowy SVG `ArcReactorTriangle`), pod nim z `fade-up` przycisk `ENGAGE JARVIS` (`z-50`, własny `position: relative`, niżej w layout flow, by nie kolidował z napisami HUD). Klik → `setPhase('login_screen')`.

Reużycie istniejących keyframes z `styles.css` (`hud-flicker`, `line-trace`, `fade-up`, `glitch-in`, `ring-spin`), dodanie nowych: `triangle-pulse`, `tile-build`, `tile-dissolve`, `screen-fracture`.

## Faza 2 — Login Stark Industries

Nowy komponent `src/components/jarvis/StarkLogin.tsx`. Reaktor z fazy 1 nie jest re-mountowany — przenosimy go translacją w górę (CSS transition na `translateY`), pod spodem `iris-open`/`fade-up` na panelu HUD `.hud-panel` z dwoma polami:

- `Login` (poprawne: `Tony`)
- `Password` (poprawne: `Stark`)
- przycisk `ACCESS GRANTED`

Walidacja lokalna. Przy błędnych danych: dodanie klasy `.access-denied` → pulsujący czerwony border (nowy keyframe `deny-pulse`) + komunikat `ACCESS DENIED` przez 1.5s. Przy poprawnych → `setPhase('transition_to_dashboard')`.

## Faza 3 — Transformacja w dashboard

W `transition_to_dashboard`:

1. Panel logowania animuje się klasą `.screen-fracture` (clip-path inset rozsuwający na boki + opacity → 0, ~700ms).
2. Reaktor zanika.
3. Renderuje się shell dashboardu (sidebar + header + `<Outlet />`), ale komponenty dashboardu (`SystemStatsStrip`, `ReactorCore` section, `ActiveTasksWidget`, `ChatPanel`) opakowane w nowy wrapper `<TileBuild delay={n}>` który aplikuje `animate-tile-build` (glitch-in + scale-in + neon border flash) z opóźnieniem losowanym deterministycznie 80–600ms per kafelek.
4. Po ~1.2s `setPhase('dashboard_active')` — wrapper przestaje wymuszać enter-animation.

`TileBuild` to czysto prezentacyjny wrapper, modyfikuje tylko otoczkę istniejących widgetów (zgodnie z regułą „UI change = frontend only").

## Faza 4 — Shutdown

Nowy przycisk `DeactivateButton` w `header` (`__root.tsx`), prawy górny róg, czerwono-karminowy (semantic token `--destructive` + glow), tekst `DEACTIVATE JARVIS`.

Klik → `setPhase('shutdown')`:

1. Wszystkie kafelki dostają klasę `.animate-tile-dissolve` (glitch-out + scale-down + blur) z losowym staggerem.
2. Po ~1.2s pełnoekranowy overlay z `hud-flicker` + fade-to-black (≈800ms).
3. `setPhase('booting')` — sekwencja startuje od nowa, ten sam komponent `BootSequence` (reset przez `key={phase}`).

## Pliki

**Nowe:**
- `src/components/jarvis/BootSequence.tsx` (3 podsekwencje + onEngage)
- `src/components/jarvis/StarkLogin.tsx` (formularz + walidacja)
- `src/components/jarvis/ArcReactorTriangle.tsx` (SVG trójkątnego reaktora)
- `src/components/jarvis/TileBuild.tsx` (wrapper enter/exit dla kafelków)
- `src/components/jarvis/DeactivateButton.tsx`

**Edytowane:**
- `src/routes/__root.tsx` — maszyna stanów `AppPhase`, warunkowy render, header z `DeactivateButton`. Zastępuje obecne `isBooted` + `JarvisBoot`.
- `src/routes/index.tsx` — owinięcie sekcji w `TileBuild` (kontekstowo — wrapper czyta fazę z Context).
- `src/styles.css` — nowe keyframes: `triangle-pulse`, `tile-build`, `tile-dissolve`, `deny-pulse`, `screen-fracture`, `type-caret`.
- `src/data/mock.ts` — dodanie `bootLogs` (IP/protokoły).

**Usunięte:**
- `src/components/jarvis/JarvisBoot.tsx` (zastąpione przez `BootSequence` + `StarkLogin`).

## Szczegóły techniczne

- Maszyna stanów: prosty `useState<AppPhase>` + `useEffect` z timerami w `BootSequence`. Brak zewnętrznej biblioteki.
- Cała koordynacja faz przez Context (`PhaseContext`) by `TileBuild` w głębi drzewa wiedział, czy grać enter, exit, czy nic.
- Animacje wyłącznie CSS (Tailwind utility + custom keyframes w `styles.css`), bez Framer Motion — spójne z dotychczasowym stackiem.
- Kolory wyłącznie z tokenów (`--primary`, `--destructive`, `--success`). Czerwień shutdown/access-denied = `--destructive` z dodatkowym glow w `box-shadow`.
- `z-index`: przycisk `ENGAGE JARVIS` `z-50`, overlay shutdown `z-[100]`, header `z-10` (bez zmian).
- Wszystkie `setTimeout` czyszczone w `useEffect` cleanup — brak wycieków przy zmianie fazy.
- Brak zmian routingu/loaderów/backendu — czysto prezentacyjne.

## Akceptacja
1. Odświeżenie strony → 15s boot bez interakcji, potem klikalny ENGAGE JARVIS.
2. `Tony` / `Stark` → przejście do dashboardu z efektem budowania kafelków.
3. Złe dane → czerwony pulsujący border + ACCESS DENIED, pole zostaje.
4. `DEACTIVATE JARVIS` w prawym górnym rogu → kafelki znikają, ekran wraca do fazy 1, cykl działa wielokrotnie.
5. Brak przeładowania (URL pozostaje `/`).
