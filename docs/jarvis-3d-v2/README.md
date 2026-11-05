# Prototyp v2: strona startowa 3D → logowanie 3D → Arc Core (jedna scena)

To jest ZATWIERDZONY wygląd. Claude Code ma PORTOWAĆ go do aplikacji, a nie reinterpretować.
Podgląd bez budowania: otwórz `demo/jarvis-3d-v2-demo.html` w przeglądarce.
(Spróbuj: „Zaloguj” w prawym górnym rogu, hasło „zle” w formularzu, potem poprawne hasło.)

## Zawartość
- `src/main.js`     scena, kamera, strona startowa (scroll), logowanie, ignition, rdzeń, formularz, HUD demo
- `src/reactor.js`  geometria reaktora, węzły agentów, shader rdzenia (hexy do zamiany na tokeny)
- `src/core2.js`    NOWE warstwy Arc Core v2: orbity agentów, pierścienie z podziałkami i kulkami, plazmowa
                    powłoka, korona, holograficzna podłoga, pakiety światła
- `src/data.js`     dane demo (w aplikacji: prawdziwe dane, patrz tabela)
- `src/index.html`  CSS i układ demo (tokeny skopiowane z src/styles.css)
- `reference/`      klatki referencyjne (desktop 1440x810, telefon 390x844) i `capture_demo.py`
- `build.mjs`       tylko do zbudowania demo
- `PROMPT.md`       jeden prompt na całe wdrożenie

## Idea
Jedna scena three.js obsługuje kolejne tryby: `scroll` (strona startowa) → `login` → `ignite` → `core`.
Kamera i elementy są funkcjami stanu (scroll, faza logowania, faza ignition `p` 0..1), więc nie ma skoków
między ekranami. Pozycja reaktora na ekranach DOM pochodzi z prostokątów elementów (`#arc-home`, `#login-slot`)
przez `fitCamera`, dzięki czemu układ HTML i scena zawsze się zgadzają.

## Stałe do strojenia (jedno miejsce)
- Skok do logowania: `JUMP_PX_PER_MS = 5.5`, `JUMP_MIN_MS = 900`, `JUMP_MAX_MS = 3000`, easing sześcienny in-out,
  przerywany przez wheel / touchstart / keydown, natychmiastowy przy prefers-reduced-motion.
- Ignition: 2600 ms (`igStart`, mianownik w `igniteFrame`).
- Login: wejście kamery 1100 ms; `fitCamera(slot, 32, 380)` (span 380 jednostek obejmuje kadłub i żyroskop).
- Orbity agentów: tablice `R`, `TILT`, `SPD` w `core2.js`.

## Mapowanie na aplikację (stan repo sprawdzony)
| Demo | Aplikacja |
|---|---|
| strona startowa (hero, agenci, tunel modułów, engage) | zastępuje `BootSequence mode="engage"` w fazie `booting` (PhaseController) |
| przycisk Engage | ten sam handler co dziś: `audio.playEngage()`, `requestAppFullscreen()`, `onEngage` → `login_screen` |
| teksty agentów i nazwy modułów | prawdziwe źródła: rejestr agentów i `src/components/jarvis/modules.ts` (MODULE_GROUPS) |
| układ logowania (slot + formularz) | `StarkLogin`, logika auth bez zmian; stare SVG `ArcReactorTriangle` zostaje jako fallback |
| zły klucz | `deny()` w StarkLogin, zdarzenie `jarvis:login-denied` (istnieje po etapie 1 poprzedniego promptu) |
| ignition | faza `initializing` (poprzedni prompt) |
| Arc Core z `main.js` + `core2.js` | `Core3D`, `JarvisCanvas`, `AgentNode3D` na /jarvis (R3F), ten sam wygląd |
| `STATUS` (idle/busy na sztywno) | prawdziwy `agent.status` (`busy` / `idle` / `error`) i `isEnabled` |
| wymiary: SCALE=72 (jednostki demo) | `MATRIX_SCALE` = 0.72 w aplikacji: każdą długość z demo mnóż przez 0.01 |

## Czego NIE przenosić z demo
Panel `#replay` („Od początku”), `window.__jv`, tryb `#shot`, napisy „Prototyp” i „Widok pokazowy”, atrapowe pola
formularza i podpowiedź o haśle „zle”, zakodowane „5 / 5 nodes online”, statyczne statusy.

## WSPÓLNE ZASADY
1. `CLAUDE.md` ma pierwszeństwo przed prototypem. Kolory tylko z tokenów; w three.js przez `themeColor.ts`
   (`resolveCssColor` / `useThemeColors`). Żadnych hexów z prototypu w kodzie aplikacji.
2. Bez nowych zależności. Scena intro (strona startowa, logowanie, ignition) to IMPERATYWNY three.js
   w `useEffect`. Ekran /jarvis zostaje w R3F: tam shader i geometrie przenosisz do komponentów R3F
   (`<shaderMaterial>` z tym samym GLSL, nie `MeshDistortMaterial`).
3. SSR (TanStack Start): three tylko po stronie klienta, dynamiczny `import()`, osobny chunk.
4. Sprzątanie przy odmontowaniu: rAF, geometrie, materiały, tekstury, composer, renderer, listenery.
5. Wszystko za przełącznikiem `isLoginSceneEnabled()` (domyślnie WYŁĄCZONY do mojej akceptacji). Gdy wyłączony,
   tryb Town, brak WebGL lub `prefers-reduced-motion: reduce`, działa dotychczasowa ścieżka (BootSequence, SVG,
   obecny Core3D).
6. Panele przewijane: `no-scrollbar`. Strony przewijalne. Landing przewija własny kontener, nie `window`.
7. Kontrole po każdym etapie: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
8. Commit po każdym etapie. Zatrzymaj się tylko w warunkach STOP z PROMPT.md. Bez merge do main.

## Kryteria akceptacji
- Logowanie działa jak dziś (hasło, Google, reset, istniejąca sesja).
- Strona startowa: przewijanie, „Zaloguj” i „Przejdź do logowania” lecą do ekranu Engage po 0,9 do 3 s i da się je
  przerwać; Engage robi to samo co dziś.
- Pole hasła ma fokus bez opóźnień, intro nie blokuje pisania.
- Przejście po logowaniu ok. 2,6 s, pomijalne kliknięciem lub klawiszem.
- /jarvis wygląda jak końcowy kadr demo (rdzeń, pierścienie, orbity, podłoga, pakiety, etykiety), a dane agentów
  i statusy są prawdziwe.
- Gdy przełącznik jest wyłączony, aplikacja wygląda i działa dokładnie jak przed zmianą.
