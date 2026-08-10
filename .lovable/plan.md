# Odświeżenie designu + mobilny bottom bar

## Cel
1. Wspólny lifting wizualny (desktop + mobile): mocniejsze zaokrąglenia, odświeżona paleta, lepszy spacing.
2. Tylko mobile: pionowy układ natywny + poziomo przesuwany bottom navigation bar zamiast sidebara.

Zero zmian w logice, danych, agentach i ścieżkach nawigacji.

## Część 1 — warstwa wizualna

### Paleta (propozycja, zachowuje cyjanowy branding JARVIS)
Obecnie: czyste czernie (`--background: oklch(0 0 0)`) + cyjan `oklch(0.88 0.17 200)`.
Propozycja: głębokie granatowo-grafitowe tło zamiast płaskiej czerni + cyjan jako akcent, plus cieplejszy bursztyn dla ostrzeżeń:

- `--background`: `oklch(0.14 0.025 250)` (deep space navy)
- `--card` / `--surface-1..3`: warstwy `oklch(0.17–0.23 0.03 250)` — realna hierarchia głębi zamiast czerni na czerni
- `--primary`: `oklch(0.84 0.15 205)` (nieco spokojniejszy cyjan, mniej wypalony)
- `--accent`: `oklch(0.78 0.13 250)` (elektryczny błękit jako drugi akcent)
- `--border` / `--input`: cyjan z niższą alfą (18% / 14%) — mniej „kratownicy”
- `--success`, `--warning`, `--destructive` zostają w obecnym charakterze, lekko przygaszone pod nowe tło

Zmiany wyłącznie w tokenach w `src/styles.css` — komponenty używają tokenów, więc paleta przechodzi globalnie.

### Zaokrąglenia
- `--radius`: `0.875rem` → `1.25rem`; skala `--radius-sm..4xl` przelicza się automatycznie.
- `.hud-panel`, `.hud-panel--elevated/--quiet`, tło sidebara, inputy, dialogi i przyciski przechodzą na `--radius-lg` / `--radius-2xl`.
- Punktowe klasy `rounded-md` w chrome (header, `HudMenuTrigger`, `FullscreenToggle`, przyciski w `HeaderVoiceToggle`, `RebootButton`, `DeactivateButton`) → `rounded-full` / `rounded-2xl`.
- Narożne bracket-y HUD zostają — dopasowane promieniem, żeby nie „odklejały się” od zaokrąglonej ramki.

### Spacing i hierarchia
- Spójniejszy rytm paddingów paneli (`p-4` / `p-6` zamiast mieszanki), większy gap w gridach dashboardu.
- Nagłówki paneli: mocniejszy kontrast tytułu vs. treść (rozmiar + tracking), słabsze obramowania, więcej oddechu.
- Sidebar desktop: ta sama zaokrąglona estetyka (zaokrąglone tło grup i pozycji menu), struktura i pozycja bez zmian.

## Część 2 — mobile (tylko smartfony)

### Układ pionowy
- `OrientationGate`: przestaje blokować portret. Zamiast listy `exemptPaths` gate nie blokuje w ogóle na telefonach (komponent zostaje w repo, wywołanie w `PhaseController` przestaje wymuszać landscape).
- Klasy wymuszające ściśnięty tryb landscape na mobile (`landscape:max-md:*` w ~64 miejscach) zostają dla realnego landscape, ale layout bazowy portretu przestaje być „ściśniętym desktopem”: kontenery pełnej szerokości, brak `max-w-*` ograniczeń na mobile, `grid-cols-1` w portrecie.
- `DashboardShell`: w portrecie `main` scrolluje pionowo, a nie `overflow-hidden`.

### Bottom navigation bar
- Nowy komponent `src/components/jarvis/MobileBottomNav.tsx`.
- Renderowany tylko na mobile (`useIsMobile`), przypięty `fixed bottom-0`, z `env(safe-area-inset-bottom)`.
- Pozioma lista z natywnym scrollem dotykowym (`overflow-x-auto`, `snap-x`, ukryty scrollbar) — ~5 ikon w kadrze, reszta po przesunięciu palcem.
- Kolejność 1:1 z sidebarem: Dashboard, Agent Hub, Tasks, Sub-Systems, Situation Room, Vision, System Logs, Schema, Documents, Settings.
- Aktywna pozycja: podświetlenie cyjanem + pigułkowe tło + kropka statusu; nawigacja przez ten sam `useHudNavigate().go`, `audio.playClick()` i blokadę `isTransitioning`/`isDiagnosticRunning` co w sidebarze — bez nowej logiki.
- `main` dostaje dolny padding równy wysokości baru, żeby treść nie chowała się pod nawigacją.

### Sidebar na mobile
- `AppSidebar` nie renderuje się na mobile (w tym panel „ARC CORE” z arc reactorem).
- `HudMenuTrigger` w headerze chowany na mobile (nie ma czego otwierać); pozostałe przyciski headera bez zmian.
- Mostek komend głosowych „open/close menu” zostaje nietknięty (na desktopie działa jak dziś).

## Szczegóły techniczne
- Zmiany tokenów: `src/styles.css` (`:root`, `--radius`, `.hud-panel*`, ewentualny nowy `@utility no-scrollbar`).
- Nowy plik: `src/components/jarvis/MobileBottomNav.tsx`.
- Modyfikowane: `DashboardShell.tsx` (mobile-aware chrome + padding + montaż bottom navu), `AppSidebar.tsx` (desktop-only + odświeżony styl), `OrientationGate.tsx` / `PhaseController.tsx` (odblokowanie portretu), `HudPanel.tsx` + `HudTag`/bracket style (zaokrąglenia/spacing), punktowe `rounded-*`/`max-w-*` w `routes/index.tsx` i pozostałych trasach oraz widgetach.
- Weryfikacja: typecheck + zrzuty ekranu z Playwrighta w trzech szerokościach (390 portret, 844 landscape, 1440 desktop).

Na koniec dostaniesz listę wszystkich zmienionych/nowych plików z jednozdaniowym opisem.
