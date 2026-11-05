Rozbuduj w aplikacji intro 3D i Arc Core na podstawie zatwierdzonego prototypu v2 w docs/jarvis-3d-v2/.
Pracuj na branchu z dotychczasową pracą nad sceną logowania (jeśli jej nie ma w repo, zacznij od najnowszego
brancha z tą funkcją albo zgłoś to jako STOP). Zacznij od przeczytania CAŁEGO docs/jarvis-3d-v2/README.md (zasady
wspólne i tabela mapowania obowiązują), potem: CLAUDE.md, git log ostatnich zmian, src/components/jarvis/login-scene/
(to, co już zbudowano), PhaseController.tsx, BootSequence.tsx, StarkLogin.tsx, Core3D.tsx, JarvisCanvas.tsx,
AgentNode3D.tsx, matrixScale.ts, modules.ts, src/routes/jarvis.tsx, themeColor.ts i src/lib/fullscreen.ts.
Przeczytaj w całości docs/jarvis-3d-v2/src/main.js, reactor.js, core2.js oraz obejrzyj wszystkie klatki z
docs/jarvis-3d-v2/reference/. Prototyp v2 zastępuje wizualnie starszy docs/login-scene-prototype/ (jego
infrastrukturę, przełącznik, matematykę i testy zachowaj i rozbuduj, wygląd bierz z v2).

## KONTRAKT WIERNOŚCI WIZUALNEJ (najważniejszy punkt)
Wygląd w aplikacji ma być IDENTYCZNY z demo v2. Zatwierdzam go dokładnie takim, jaki jest. Portujesz, nie reinterpretujesz.
1. reactor.js i core2.js przenieś 1:1: geometrie, liczby segmentów i podziałek, materiały, shader rdzenia, tekstura
   radialna, parametry orbit (R, TILT, SPD), kolejność i krzywe animacji (p, seg, ease, bezier kamery), płynne
   przejścia kamery. Dla /jarvis (R3F) przelicz wymiary: jednostki demo × 0.01 (SCALE 72 → MATRIX_SCALE 0.72),
   w tym promienie, grubości, rozmiar węzłów, długości podziałek, skalę korony i podłogi. Rozmiar punktów
   i światło dobierz tak, by wizualnie odpowiadały demo, i opisz zastosowane przeliczenie.
2. Parametry renderowania jak w demo: NoToneMapping, bloom (siła .3 → .62, promień .45/.55, próg .5/.55) bez
   „wypalania" do jednolitej barwy, mgła, fov 32 → 45, 800 punktów pyłu. W R3F (/jarvis) zastąp obecny Bloom
   (intensity 1.5, threshold .2) ustawieniami dającymi wygląd z demo, a nie blaszaną, żółtą kulę.
3. ZAKAZ: MeshDistortMaterial w nowym rdzeniu, zmniejszania liczby segmentów lub rozdzielczości tekstur, dodawania
   i usuwania efektów, „upraszczania dla wydajności", zmiany kolorów, proporcji i tempa. Żadnego pikselowego
   ani uproszczonego wyglądu.
4. Kolory z tokenów (themeColor.ts), a wartości w domyślnym motywie mają wyjść takie same jak w prototypie
   (primary #00e6f9, accent #73bdff, reactor #ffad00, hot #ffcd42). Zweryfikuj i podaj wynik; rozbieżność to STOP.
5. Jedyna dozwolona różnica w jakości: automatyczne obniżanie DPR po min. 120 klatkach, gdy ponad połowa ma
   > 34 ms, z dolną granicą min(devicePixelRatio, 1,25). Nie ruszaj geometrii, shadera ani bloomu.
6. Dowód zgodności (obowiązkowy). Dodaj hak diagnostyczny tylko w DEV (import.meta.env.DEV), usuwany z produkcji,
   który pozwala ustawić fazę sceny intro. Zrób zrzuty aplikacji w tych samych kadrach co docs/jarvis-3d-v2/reference/
   (desktop 1440x810 i telefon 390x844; wzór: reference/capture_demo.py, Playwright z flagami SwiftShader):
   hero, agent a1, tunel modułów, engage, login, ignition .25/.5/.75, końcowy kadr. Dodatkowo zrób zrzut
   prawdziwego ekranu /jarvis i porównaj go z desktop_corefinal.png. Zestaw je obok siebie i opisz każdą różnicę.
   Dozwolone różnice: kadr /jarvis (canvas ma ok. 60% wysokości), prawdziwy HUD, prawdziwe nazwy i statusy.
   Niedozwolone: geometria, kolory, bloom, ostrość. Jeśli nie da się uruchomić przeglądarki z WebGL, napisz to wprost
   i NIE twierdź, że zgodność jest potwierdzona.

## WARUNKI STOP (zatrzymaj się i zapytaj)
- fakt z tabeli mapowania jest nieprawdziwy albo brakuje poprzedniej pracy nad sceną logowania,
- wierne odtworzenie wyglądu koliduje z SSR, bundlerem, R3F lub CLAUDE.md i potrzebna byłaby zmiana wyglądu,
- tokeny dają inne kolory niż prototyp,
- musiałbyś zmienić logikę auth, audio lub routingu poza opisanym zakresem,
- zmierzona płynność wymaga obcięcia efektów,
- liczba agentów lub struktura danych nie pasuje do orbit z core2.js (tablice mają 6 pozycji, cyklicznie).
Poza tym pracuj do końca, z commitem po każdym etapie.

## ETAP A: jedna scena intro na wszystkie fazy
Rozbuduj istniejący createLoginScene (albo wydziel następcę, np. createIntroScene) tak, by jedna scena three.js
obsługiwała tryby jak w prototypie: scroll → login → ignite → core, i żyła w fazach booting, login_screen,
initializing i transition_to_dashboard (stabilny key, bez remountu między fazami). Rozbuduj loginSceneMath.ts
o czyste funkcje: mapowanie scrolla na stan kamery, czas skoku (clamp(px / JUMP_PX_PER_MS, JUMP_MIN_MS,
JUMP_MAX_MS)), easing skoku, mapowanie p ignition, pozycja kamery logowania. Testy vitest dla każdej. Przełącznik
isLoginSceneEnabled() zostaje jedynym bramkarzem. Commit.

## ETAP B: strona startowa zamiast ekranu Engage
Gdy isLoginSceneEnabled() && tryb HUD && WebGL && prefers-reduced-motion nie jest „reduce": w fazie booting
renderuj stronę startową z prototypu zamiast BootSequence mode="engage". W przeciwnym razie zostaje obecny ekran.
1. Przewijany kontener `fixed inset-0 overflow-y-auto no-scrollbar` (nie window). Sekcje i wysokości jak w
   prototypie (hero, jarvis, agenci, tunel modułów, engage); pozycje przystanków liczone z getBoundingClientRect
   względem kontenera (jak layout() w main.js). Teksty DOM zostają w DOM (dostępność), tunel i planszy modułów
   w 3D, z nazwami modułów z modules.ts (MODULE_GROUPS) i opisami z prototypu, jeśli w repo ich brakuje.
2. Agenci na stronie startowej: nazwy i role z istniejącego rejestru agentów w repo, opisy z prototypu (data.js) tylko
   dla agentów, których tam nie ma, wskaż je w raporcie.
3. Przyciski „Zaloguj” (górny pasek) i „Przejdź do logowania” (hero) przewijają przez własną pętlę requestAnimationFrame
   (nie natywny smooth scroll) według stałych z README: 5,5 px/ms, min 900 ms, max 3000 ms, easing in-out. Przerywane
   przez wheel, touchstart i keydown, natychmiastowe przy reduced-motion. Stałe w jednym miejscu.
4. Sekcja Engage na końcu: przycisk robi dokładnie to, co dziś (audio.playEngage(), requestAppFullscreen(), onEngage →
   login_screen). Odczytaj handler z BootSequence.tsx i zachowaj go bez zmian.
5. Wracający użytkownicy: stała LANDING_SKIP_IF_SEEN = true. Jeśli localStorage["jarvis.landingSeen"] === "1",
   strona startowa otwiera się od razu na sekcji Engage (górny pasek „Zaloguj” zostaje). Flaga zapisywana po pierwszym
   kliknięciu Engage. Zachowanie łatwe do wyłączenia jedną stałą.
Commit.

## ETAP C: logowanie 3D (v2)
1. Przejście Engage → logowanie: kamera z pozycji Engage do pozycji logowania w 1100 ms (jak w prototypie), DOM-owy
   reaktor SVG znika, a 3D przejmuje ten sam kadr.
2. Układ StarkLogin przy aktywnej scenie: dwie kolumny (slot reaktora po lewej, kolumna z listą statusów i formularzem po
   prawej), na wąskich ekranach jedna kolumna. Slot jest źródłem kadru: fitCamera(slot, 32, 380). Logika auth bez zmian.
   Lista statusów (kanał szyfrowany, macierz agentów, biometria) ma rzeczywiste liczby (liczba agentów z cache
   react-query ["agents","list"], jeśli jest), bez zakodowanych wartości.
3. Reaktor z kadłubem i pierścieniami żyroskopu, parallax od myszy (±22/±14), reakcja na pisanie i fokus
   (przyspieszenie pierścieni, delikatny wzrost bloomu), drżenie i czerwone zabarwienie przy odmowie dostępu
   (clamp(shake * 1.8) * .95, tint na --destructive). Fokus w polu hasła bez opóźnień, intro nie blokuje pisania.
Commit.

## ETAP D: ignition i końcowy kadr intro
Faza initializing: przejście p 0 → 1 w 2,6 s jak w prototypie (kadłub znika w pierwszych 25% p, reaktor się rozpada,
rdzeń się rozpala, pierścienie z podziałkami rosną, agenci wylatują na swoje orbity z core2.js, korona, powłoka,
podłoga, orbity i pakiety światła pojawiają się wg krzywych z prototypu). Skip: pointerdown/keydown przyspiesza x6.
Reduced-motion: wariant „min" (cięcie ukryte w zaniku do czerni, bez błysków). Gdy p osiągnie ok. 0,58, PhaseController
przechodzi do transition_to_dashboard, a overlay sceny dostaje pointer-events:none i znika płynnie.
Liczba węzłów agentów z cache react-query, domyślnie 5. Kadr końcowy jak w prototypie (coreCam i fov 45, mnożnik
clamp(1.35 / aspect, 1, 2.5)). Etykiety w overlayu tylko jeśli masz prawdziwe nazwy agentów, bez nich zostaw same
węzły. Commit.

## ETAP E: Arc Core v2 na ekranie /jarvis
To główna zmiana wyglądu aplikacji. Przełącz ją tym samym przełącznikiem isLoginSceneEnabled(): wyłączony = obecny
Core3D i AgentNode3D bez zmian (zostaw je jako wariant legacy, np. Core3DLegacy), włączony = nowy wygląd.
1. Core3D v2: ten sam rdzeń (shader „molten" z reactor.js jako <shaderMaterial>, bez MeshDistortMaterial), plazmowa
   powłoka (wireframe icosahedron detail 2), korona (sprite, addytywna, depthTest wyłączony), trzy pierścienie
   z podziałkami i kulkami krążącymi po obwodzie, pulsowanie jak w prototypie. Światło punktowe dobrane tak, by wygląd
   zgadzał się z demo.
2. JarvisCanvas v2: orbity per agent z orbitSpec (promień, nachylenie, prędkość kątowa; agenci krążą po orbitach),
   cienkie ścieżki orbit, holograficzna podłoga, pakiety światła (szybkie bursztynowe dla agentów ze statusem busy,
   wolne cyjanowe dla pozostałych), pył, bloom z punktu 2 kontraktu. Pozycja i kadr kamery: coreCam z prototypu
   skalowany do proporcji canvasu (useThree size), minDistance/maxDistance proporcjonalne.
3. AgentNode3D v2: mniejsze węzły (0.8 skali), kolory statusów z tokenów (idle primary, busy reactor, error
   destructive, disabled jak dziś), pulsowanie węzłów busy, etykiety obok węzła po stronie zewnętrznej (nazwa, rola,
   status ze znacznikiem ●, dla busy z czasem z busySince), bez nakładania na węzeł i rdzeń. Zachowaj hover, zaznaczenie,
   kartę szczegółów i onSelect.
4. Nie zmieniaj kontraktu props JarvisCanvas ani routes/jarvis.tsx poza wyborem wariantu. HudOverlay,
   AgentRegistryPanel i MatrixChatConsole bez zmian. Wydajność: instancing dla podziałek, brak alokacji w useFrame.
Commit.

## ETAP F: wykończenie i weryfikacja
1. Wydajność: DevTools Performance (desktop i emulacja telefonu z throttlingiem CPU) dla strony startowej, skoku do
   logowania, ignition i /jarvis. Podaj czasy klatek. Przy problemach najpierw dane i przyczyna (STOP), bez obcinania efektów.
2. Bundle: intro 3D w osobnym leniwym chunku, /jarvis nie ładuje więcej niż dziś przy wyłączonym przełączniku. Podaj rozmiary.
3. Pamięć: wielokrotne wejście i wyjście (wylogowanie, ponowne logowanie, nawigacja /jarvis ↔ inne trasy) bez wycieku
   kontekstów WebGL i listenerów.
4. Dostępność i ruch: canvas aria-hidden, nawigacja klawiaturą po stronie startowej (przycisk „Zaloguj” fokusowalny),
   reduced-motion bez błysków, fokus w polu hasła.
5. OrientationGate i wąskie viewporty: sprawdź interakcję.
6. Testy vitest: czysta logika (przełącznik, matematyka kamery i skoku, mapowanie p, wybór wariantu ruchu, orbitSpec),
   smoke test bez WebGL (jsdom) wybierający starą ścieżkę.
7. Dopisz do CLAUDE.md sekcję o intro 3D i Arc Core v2: tokeny, przełącznik, leniwy import, jednostki (×0.01),
   kontrakt wiernej zgodności z prototypem.
8. Kontrole: typecheck, lint, test, build. Wszystkie przechodzą.
Commit.

## RAPORT KOŃCOWY (obowiązkowy)
1. Dowód zgodności wizualnej (punkt 6 kontraktu): zestawienie zrzutów i opis różnic, osobno dla intro i dla /jarvis.
2. Wynik porównania kolorów tokenów z prototypem.
3. Zmierzone czasy: skok do logowania, ignition, start transition_to_dashboard, dashboard_active.
4. Rozmiary chunków i potwierdzenie, że ścieżka z wyłączonym przełącznikiem nie ładuje intro 3D.
5. Co zostało zakodowane na sztywno lub wzięte z prototypu zamiast z danych aplikacji (lista).
6. Czego nie dało się sprawdzić (np. realnej płynności na GPU) i lista rzeczy do mojej ręcznej weryfikacji.
7. Jedna linia do zmiany, żeby włączyć nowy wygląd domyślnie.
NIE usuwaj docs/jarvis-3d-v2/ ani docs/login-scene-prototype/ i NIE zmieniaj domyślnej wartości przełącznika, dopóki
sam tego nie zatwierdzę. Nie rób merge do main.
