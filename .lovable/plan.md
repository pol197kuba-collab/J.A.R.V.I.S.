## Cel
Przebudować wewnętrzny dashboard JARVIS-a (po zalogowaniu) tak, aby był idealnym przedłużeniem estetyki Stark HUD z intra: czarne tło, neonowy cyjan, monospace, ostre rogi, corner brackets, mikroteksty. Dodać 3-4 sekundowy system przejść między zakładkami z blokadą wielokrotnych kliknięć.

## 1. Globalna stylistyka (`src/styles.css`)

- Dodać import Google Fonts `JetBrains Mono` + `Share Tech Mono` w `__root.tsx` (`<link>` w head).
- Zmienić `--background` na czystą czerń `oklch(0 0 0)`, `--card` na ~`oklch(0.04 0 0)`, `--sidebar` analogicznie.
- Wzmocnić `--primary` do neonowego cyjanu `oklch(0.88 0.18 200)` (≈ #00f0ff), wzmocnić `--glow-primary`.
- `body` → `font-family: "JetBrains Mono", ui-monospace, monospace;` `.font-display` → `"Share Tech Mono"`.
- Domyślny `--radius: 0`. Wszystkie panele HUD i shadcn cards renderują się z ostrymi rogami.
- Rozszerzyć `.hud-panel` o 4 corner-brackety (obecnie 2) oraz wariant `.hud-panel--tag` z absolutnie pozycjonowanym mikrotekstem (`SYS_REF`).

## 2. Komponenty wspólne

- `MiniArcReactor.tsx` — mała, kręcąca się + pulsująca wersja trójkątnego reaktora (reuse `ArcReactorTriangle` w skali). Umieścić w `AppSidebar` (header) obok napisu `J.A.R.V.I.S.`.
- `HudTag.tsx` — generuje losowy mikrotekst (`SYS_REF: 404-X`, `CH-${n}`, `0xAF12`) na podstawie seed (deterministyczny per-mount, by nie migotał). Wstawiany w narożniki kafelków.
- `HudPanel.tsx` — wrapper opakowujący treść w `.hud-panel` + 1-2 `HudTag` w narożnikach + opcjonalny tytuł.

## 3. Przebudowa kafelków dashboardu

Wszystkie sekcje (`SystemStatsStrip`, `ReactorCore` panel, `ActiveTasksWidget`, `ChatPanel`, oraz analogiczne karty w `agent-hub`, `system-logs`, `settings`) opakować w `HudPanel`:
- Ostre rogi, cyjanowe ramki, neon glow.
- Tabele i listy: monospace, wiersze z `border-b` w półprzezroczystym cyjanie, hover = jasna poświata.
- Ikony Lucide w cyjanie z `drop-shadow`.
- Wykresy/sparkline (`SystemStatsStrip`) — barki z mocniejszym cyjanowym glow.

## 4. System przejść HUD (kluczowe)

Stworzyć `src/components/jarvis/HudRouteTransition.tsx`:

- Stan globalny w `PhaseContext` (rozszerzenie) lub nowy `TransitionContext`:
  ```
  transition: 'idle' | 'dematerialize' | 'scan' | 'materialize'
  pendingPath: string | null
  isTransitioning: boolean
  ```
- Hook `useHudNavigate()` zwracający funkcję `go(path)`:
  1. Jeśli `isTransitioning` → ignoruj (blokada multi-klik).
  2. `setTransition('dematerialize')` + `pendingPath = path`.
  3. Po 1500 ms → `router.navigate({ to: path })`, `setTransition('scan')`.
  4. Po 1000 ms → `setTransition('materialize')`.
  5. Po 1500 ms → `setTransition('idle')`.
- `AppSidebar` używa `<button onClick={() => go(item.url)}>` zamiast `<Link>`, z `disabled={isTransitioning}` + wizualnym wyciszeniem.

### Warstwy wizualne (renderowane w `__root.tsx` nad `<Outlet />`):

- **Dematerialize overlay** (1.5 s): pełnoekranowy `div` z animacją pionowych skanujących pasków (clip-path 8 kolumn animowanych z stagger), na zawartości `<main>` aplikuje się klasa `animate-hud-dematerialize` (clip-path + blur + opacity → 0).
- **Scan overlay** (1 s): pozioma neonowa linia przechodząca góra→dół (`animate-hud-laser-scan`), pośrodku migający tekst `RECONFIGURING DATA STREAM…` / `ANALYZING HUD LAYOUT…` (`animate-hud-flicker`). Tło ciemne ze ścianką siatki.
- **Materialize**: kafelki nowej trasy renderują się z `HudPanel`-owym efektem stagger:
  - Każdy `HudPanel` w fazie `materialize` dostaje `animate-hud-border-draw` (SVG rect z `stroke-dasharray` rysujący ramkę) + `animate-hud-tile-in` (blur 8 → 0, opacity 0 → 1) z `animationDelay` opartym o `index * 120ms`.
  - Wewnątrz `HudPanel` użyć `usePhase`/`useTransition` do wyzwolenia animacji wjeżdżającej.

### Nowe keyframes w `styles.css`

- `hud-dematerialize` (clip-path + opacity + blur)
- `hud-vertical-scan` (paski clip-path z stagger przez `animation-delay`)
- `hud-laser-scan` (translateY -100% → 100%, neon line)
- `hud-border-draw` (SVG `stroke-dashoffset`)
- `hud-tile-in` (blur 10px → 0, opacity 0 → 1, translateY 6px → 0)
- `hud-text-flicker-fast` (szybki migający komunikat statusu)

## 5. Integracja w `__root.tsx`

- Dodać `TransitionProvider`.
- Renderować `<HudRouteTransition />` (overlaye) nad `<main>`.
- `main` dostaje `data-transition={transition}` → CSS aplikuje `animate-hud-dematerialize` w fazie `dematerialize`.
- `TileBuild` zostaje uproszczony do nasłuchu na fazę `materialize` (nadal działa też dla bootu).

## 6. Zakładki — przegląd zawartości

Każda zakładka przerobiona na siatkę `HudPanel`-i z `index`-em do staggera:

- **Dashboard**: bez zmian funkcjonalnych, nowy styling + tagi narożne.
- **Agent Hub**: tabela agentów w `HudPanel`, status pill w neonie, mini-sparkline.
- **System Logs**: terminalowy strumień (monospace), kolumny `TS / LVL / SRC / MSG`, kolory poziomów (cyjan / pomarańcz / czerwony).
- **Settings**: panele konfiguracji z toggle/slider w cyjanowej stylistyce.

## 7. Walidacja

- Typecheck.
- Wizualny smoke test przez Playwright: boot → login (Tony/Stark) → klik między 4 zakładkami; weryfikacja, że overlay przejścia trwa ~4 s i drugie kliknięcie w trakcie jest ignorowane.

## Pliki

Nowe:
- `src/components/jarvis/HudPanel.tsx`
- `src/components/jarvis/HudTag.tsx`
- `src/components/jarvis/MiniArcReactor.tsx`
- `src/components/jarvis/HudRouteTransition.tsx`
- `src/components/jarvis/TransitionContext.tsx`
- `src/hooks/use-hud-navigate.ts`

Edytowane:
- `src/styles.css` (tokeny, fonty, nowe keyframes)
- `src/routes/__root.tsx` (provider, overlay, font link)
- `src/components/jarvis/AppSidebar.tsx` (mini-reactor, nawigacja przez `useHudNavigate`, disabled w trakcie)
- `src/routes/index.tsx`, `src/routes/agent-hub.tsx`, `src/routes/system-logs.tsx`, `src/routes/settings.tsx` (HudPanel + stagger index)
- `src/components/jarvis/SystemStatsStrip.tsx`, `ActiveTasksWidget.tsx`, `ChatPanel.tsx` (HudPanel skin)
