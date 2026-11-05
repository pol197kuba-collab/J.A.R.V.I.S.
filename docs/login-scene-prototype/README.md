# Prototyp: login → Arc Core w jednej scenie 3D

Źródła demo, z którego Claude Code ma PORTOWAĆ logikę do aplikacji. To nie jest kod do skopiowania 1:1.
Podgląd bez budowania: otwórz `demo/jarvis-login-demo.html` w przeglądarce (panel DEMO w rogu jest tylko do pokazu).

## Zawartość
- `src/reactor.js`  geometria reaktora, węzły agentów, shader rdzenia (kolory jako hexy, do zamiany na tokeny)
- `src/main.js`     scena, kamera, faza `p`, formularz, HUD, panel DEMO (do rozdzielenia, patrz niżej)
- `src/data.js`     dane agentów z demo (w aplikacji pochodzą z prawdziwych danych)
- `src/index.html`  CSS i układ demo (tokeny kolorów skopiowane z `src/styles.css`)
- `build.mjs`       tylko do zbudowania demo, nie do aplikacji
- `reference/`      klatki referencyjne demo (desktop 1440x810, telefon 390x844) i `capture_demo.py`
- `PROMPT.md`       jeden prompt na całe wdrożenie

## Idea (jedna zmienna fazy)
`p` ∈ [0,1]: 0 = ekran logowania, 1 = Arc Core. Każdy element sceny to czysta funkcja `p`, więc ta sama
animacja działa w obie strony. Kamera jedzie po krzywej Béziera (login → nurkowanie → pozycja rdzenia),
reaktor rozpada się i blaknie, rdzeń się rozpala, pierścienie rosną do orbit, agenci lecą na orbity.
Pozycja reaktora na logowaniu pochodzi z prostokąta elementu DOM (`#slot`) przez `fitCamera`, więc układ
formularza i scena zawsze się zgadzają.

## Stałe do strojenia (jedno miejsce)
- `DUR = { full: 2.4, short: 0.9, min: 0.4 }` czas przejścia w sekundach
- `P_LIVE = 0.58` faza, od której HUD jest klikalny (ok. 1,4 s przy pełnym czasie)
- Szybkość przyspieszenia po kliknięciu lub klawiszu: mnożnik 6 w `frameStep`

## Mapowanie na aplikację (zweryfikowane w repo)
| Demo | Aplikacja |
|---|---|
| `#slot` + reaktor 3D | zamiast `ArcReactorTriangle` w `StarkLogin` (SVG zostaje jako fallback) |
| formularz w DOM | istniejący `StarkLogin`, logika auth bez zmian |
| `go(1)` po poprawnym haśle | faza `initializing` w `PhaseController` (dziś `BootSequence mode="init"`, 10 s) |
| zły klucz, drżenie reaktora | `deny()` w `StarkLogin` |
| końcowy kadr, rdzeń + agenci | po zalogowaniu HUD ląduje na `/jarvis` (`MODE_HOME.hud`), czyli `JarvisCanvas` |
| `p ≥ P_LIVE` HUD klikalny | `transition_to_dashboard` startuje, gdy scena jest jeszcze w trakcie zanikania |
| wylogowanie, `go(-1)` | NIE w pierwszym podejściu (dziś shutdown → booting) |

## Czego NIE przenosić z demo
Panel DEMO (`#demo`, przyciski trybów, „Złe hasło”, pasek czasu), `window.__f`, tryb `#shot`,
atrapowe dane agentów, pola formularza z demo, napis „Demo”.

## WSPÓLNE ZASADY (obowiązują w każdym etapie)
1. `CLAUDE.md` ma pierwszeństwo przed prototypem. Kolory tylko z tokenów (`--primary`, `--reactor`,
   `--reactor-hot`, `--destructive`, `--background`); w three.js przez `src/lib/theme/themeColor.ts`
   (`resolveCssColor` / `useThemeColors`). Żadnych hexów z `reactor.js` w kodzie aplikacji.
2. Bez nowych zależności. `three` jest w projekcie; `EffectComposer`, `UnrealBloomPass`, `OutputPass`
   i `OrbitControls` z `three/addons`. Scena zostaje IMPERATYWNYM three.js w `useEffect`, nie przepisuj na R3F.
3. Aplikacja jest SSR (TanStack Start): kod three.js ładuj wyłącznie po stronie klienta, przez dynamiczny
   `import()` w `useEffect`, jako osobny chunk. Nic z `three` na górze modułu importowanego przez serwer.
4. Sprzątanie przy odmontowaniu: `cancelAnimationFrame`, `dispose` geometrii, materiałów, tekstur,
   composera i renderera, usunięcie listenerów.
5. Nie zmieniaj logiki auth ani `audio.*` w `StarkLogin`. Nie usuwaj `ArcReactorTriangle` ani
   `BootSequence`: stara ścieżka ma działać jako fallback.
6. Wszystko za przełącznikiem `isLoginSceneEnabled()` (domyślnie WYŁĄCZONY do mojej akceptacji;
   włączany przez `?loginScene=1` w URL lub `localStorage["jarvis.loginScene"]="1"`).
   Tryb Town, brak WebGL, `prefers-reduced-motion: reduce` i wersje bez przełącznika działają jak dziś,
   z wyjątkiem opisanym w etapie 2.
7. Panele przewijane: `no-scrollbar`. Strony muszą zostać przewijalne. Bez wariantów `portrait:`
   w nowych komponentach, chyba że dotyczą fizycznego viewportu.
8. Kontrole po każdym etapie: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
   Zgłoś wynik i co sprawdziłeś w przeglądarce (desktop i telefon), a czego nie dało się sprawdzić
   (na przykład realnej płynności na GPU). Nie zgaduj, że działa.
9. Po każdym etapie zrób commit na branchu. Zatrzymaj się tylko w warunkach STOP z PROMPT.md. Nie rób merge do main.

## Kryteria akceptacji całości
- Logowanie działa jak dziś (poprawne i złe hasło, Google, reset hasła, istniejąca sesja → pominięcie).
- Pole hasła ma fokus od pierwszej klatki, intro nie blokuje pisania.
- Przejście po logowaniu trwa ok. 2,4 s i da się je pominąć kliknięciem lub klawiszem.
- Przy `prefers-reduced-motion` zamiast ruchu kamery jest zanikanie do czerni, bez błysków.
- Przy wolnych klatkach jakość spada automatycznie (DPR 1, słabszy bloom).
- Bez WebGL użytkownik dostaje obecny ekran z SVG.
- Dashboard w trybie HUD ląduje na `/jarvis` bez zmian w `JarvisCanvas`.
