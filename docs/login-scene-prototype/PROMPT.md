Wdróż w aplikacji scenę 3D logowania i rozpalenia Arc Core na podstawie prototypu w docs/login-scene-prototype/.
Pracuj na nowym branchu, nie na main. Zacznij od przeczytania CAŁEGO docs/login-scene-prototype/README.md
(zasady wspólne i tabela mapowania obowiązują) oraz: CLAUDE.md, src/components/jarvis/PhaseController.tsx,
StarkLogin.tsx, ArcReactorTriangle.tsx, BootSequence.tsx, Core3D.tsx, JarvisCanvas.tsx, matrixScale.ts,
PhaseContext.tsx, DashboardShell.tsx, src/lib/theme/themeColor.ts i src/lib/theme/uiMode.ts. Przeczytaj też
docs/login-scene-prototype/src/reactor.js i main.js w całości oraz obejrzyj klatki z docs/login-scene-prototype/reference/.

## KONTRAKT WIERNOŚCI WIZUALNEJ (najważniejszy punkt, ma pierwszeństwo przed wszystkim poza bezpieczeństwem)

Wygląd w aplikacji ma być IDENTYCZNY z demo. Grafika, modele i kolory mają zostać takie, jakie są w prototypie.
Portujesz, a nie „reinterpretujesz".
1. reactor.js przenieś 1:1: geometrie (ExtrudeGeometry, segmenty, liczby ząbków i znaczników), materiały,
   shader rdzenia (szum simplex), wartości liczbowe, SCALE = 72, tekstura radialna 512 px, kula rdzenia 128x96.
2. Parametry renderowania identyczne: NoToneMapping, antialias:false + EffectComposer (RenderPass, UnrealBloomPass,
   OutputPass), bloom (siła .3 → .62, promień .45/.55, próg .5/.55), mgła, fov 32 → 45, 800 punktów pyłu o rozmiarze 2,4,
   limit DPR min(devicePixelRatio, 1,75; 1,5 na wąskich ekranach), te same krzywe czasowe (p, seg, ease, bezier kamery).
3. ZAKAZ: przepisywania na R3F/drei, zastępowania shadera MeshDistortMaterial, zmniejszania liczby segmentów lub
   rozdzielczości tekstur, dodawania i usuwania efektów post-processingu, „upraszczania dla wydajności", zmiany
   kolorów, proporcji i tempa animacji. Żadnego pikselowego ani uproszczonego wyglądu.
4. Kolory: z tokenów przez themeColor.ts, ale ich wartości w domyślnym motywie muszą wyjść takie same jak w
   reactor.js (C: primary 0x00e6f9, accent 0x73bdff, reactor 0xffad00, hot 0xffcd42). Sprawdź to i podaj
   wynik w raporcie. Jeśli tokeny dają inny kolor, napisz o tym, nie poprawiaj na własną rękę.
5. Jedyna dozwolona różnica w jakości: automatyczne obniżanie. Uruchamiaj je dopiero po min. 120 klatkach, gdy ponad
   połowa ma czas > 34 ms, i obniżaj WYŁĄCZNIE DPR, z dolną granicą min(devicePixelRatio, 1,25) (demo schodzi do 1,
   co na ekranie retina daje pikselozę, więc to ma być łagodniejsze). Nie ruszaj geometrii, shadera ani bloomu.
6. Dowód zgodności (obowiązkowy): zbuduj hak diagnostyczny dostępny tylko w trybie DEV (import.meta.env.DEV),
   np. window.__loginScene z set(p) i frame(), usuwany z buildu produkcyjnego. Zrób zrzuty aplikacji w tych samych
   fazach p co klatki referencyjne (0, 0.1, 0.2, 0.3, 0.5, 0.7, 1) w 1440x810 i 390x844, używając
   docs/login-scene-prototype/reference/capture_demo.py jako wzoru (Playwright z flagami SwiftShader).
   Zestaw je obok referencji i opisz każdą różnicę. Różnice dozwolone: formularz, panel DEMO, HUD i tło strony.
   Różnice niedozwolone: geometria, kolory, bloom, ostrość. Jeśli w Twoim środowisku nie da się uruchomić
   przeglądarki z WebGL, napisz to wprost i NIE twierdź, że zgodność jest potwierdzona.

## WARUNKI STOP (zatrzymaj się i zapytaj, zamiast improwizować)
- fakt z tabeli mapowania w README okazuje się nieprawdziwy (np. HUD nie ląduje na /jarvis, StarkLogin nie pomija
  logowania przy sesji),
- wierne odtworzenie wyglądu koliduje z SSR, bundlerem lub zasadami z CLAUDE.md i potrzebna jest zmiana wyglądu,
- tokeny dają inne kolory niż prototyp,
- musiałbyś zmienić JarvisCanvas, Core3D lub logikę auth,
- zmierzona płynność wymaga obcięcia efektów.
W każdym z tych przypadków opisz problem, dane i opcje. Poza tym pracuj do końca bez zatrzymywania, z commitem po
każdym etapie.

## ETAP 1: przełącznik i ekran logowania ze sceną 3D
1. isLoginSceneEnabled() w miejscu zgodnym z konwencją repo. Domyślnie FALSE (włączenie: ?loginScene=1 albo
   localStorage["jarvis.loginScene"]="1"). Test vitest. Wskaż mi w raporcie jedną linię, którą zmienię na true.
2. Moduł src/components/jarvis/login-scene/:
   - loginSceneMath.ts: czyste funkcje bez three i DOM (krzywa Béziera kamery, mapowanie p na parametry, DUR, P_LIVE).
     Testy vitest: końce krzywej, monotoniczność, wartości graniczne.
   - createLoginScene.ts: imperatywny three.js bez Reacta, port logiki z main.js (reaktor, kamera z fitCamera na
     prostokąt slotu, parallax od myszy, boot intro 1,5 s, shake, bloom). API: layout(slotRect), setPhase(p), shake(),
     setReducedMotion(bool), dispose().
   - LoginScene.tsx: wrapper React. Canvas fixed inset-0 pod formularzem, aria-hidden. three ładowane dynamicznym
     import() w useEffect (SSR!), osobny chunk. Pełne sprzątanie w cleanup (rAF, geometrie, materiały, tekstury,
     composer, renderer, listenery).
3. Integracja z fazą login_screen: <LoginScene> renderowany tylko gdy isLoginSceneEnabled() && phase login_screen &&
   tryb UI hud && WebGL dostępny. Inaczej wszystko jak dziś. StarkLogin dostaje opcjonalny prop (np. sceneActive):
   gdy true, zamiast ArcReactorTriangle renderuje pusty slot o tych samych wymiarach (data-login-reactor-slot), z którego
   scena bierze prostokąt. Zły klucz: w deny() wyślij CustomEvent "jarvis:login-denied", scena robi drżenie reaktora
   (0,45 s, zabarwienie na --destructive). Nie zmieniaj logiki auth ani audio.
4. Pole hasła ma fokus od pierwszej klatki, intro nie blokuje pisania, klik lub klawisz pomija intro.
Commit.

## ETAP 2: rozpalenie Arc Core po zalogowaniu
Tylko gdy isLoginSceneEnabled() && tryb HUD && WebGL && prefers-reduced-motion nie jest „reduce" (dla reduce patrz
punkt 5). W innych przypadkach (Town, brak WebGL, przełącznik wyłączony) działa stara ścieżka z BootSequence init (10 s).
1. Scena nie odmontowuje się przy zmianie fazy: zamontuj <LoginScene> na poziomie PhaseController dla faz
   login_screen, initializing i transition_to_dashboard (stabilny key, bez remountu).
2. Po onGranted (nawigacja do /jarvis zostaje jak dziś) faza initializing odpala przejście p: 0 → 1 w 2,4 s
   (DUR.full): kamera nurkuje po krzywej, reaktor się rozpada, rdzeń się rozpala, pierścienie rosną, agenci wylatują na
   orbity. Błysk jako var(--reactor), max 30% krycia, dokładnie jak w demo.
3. Gdy p osiągnie P_LIVE (ok. 1,4 s), PhaseController ustawia transition_to_dashboard (dashboard się montuje),
   a overlay sceny dostaje pointer-events:none i znika płynnie do p=1. Istniejący timer 1400 ms do dashboard_active
   zostaje bez zmian. Sprawdź, że oba układy czasu ze sobą współgrają.
4. Skip: pointerdown lub keydown podczas przejścia przyspiesza je (mnożnik 6).
5. prefers-reduced-motion: reduce → wariant „min" z demo (cięcie kamery ukryte w zaniku do czerni, bez błysku,
   DUR.min = 0,4 s).
6. Kadr końcowy: pozycja kamery i fov jak w JarvisCanvas (MATRIX_SCALE z matrixScale.ts). Liczba węzłów agentów z cache
   react-query (klucz ["agents","list"]) jeśli jest, inaczej 5. W overlayu bez tekstowych etykiet z nazwami i bez
   zakodowanych „5 / 5 online". HUD z demo (roster, tytuł) NIE jest przenoszony: prawdziwym HUD jest /jarvis.
7. Canvas na /jarvis zajmuje ok. 60% wysokości widoku, a overlay jest pełnoekranowy, więc przejście to płynne
   przenikanie, a nie pikselowa zgodność. Jeśli zobaczysz niepożądany skok albo dwa rdzenie naraz, opisz to
   i zaproponuj opcje (np. camera.setViewOffset do prostokąta canvasu /jarvis), ale nie wdrażaj bez pytania.
Commit.

## ETAP 3: wykończenie i weryfikacja
1. Wydajność: DevTools Performance (desktop, a jeśli się da, emulacja telefonu z throttlingiem CPU). Podaj czasy klatek
   przejścia. Przy problemach najpierw przyczyna i dane (warunek STOP), bez obcinania efektów.
2. Bundle: three w osobnym, leniwym chunku. Ścieżka z wyłączonym przełącznikiem nie ładuje więcej niż dziś. Podaj rozmiary.
3. Pamięć: wielokrotne wejście i wyjście z logowania (wylogowanie, ponowne logowanie) nie zostawia kontekstów WebGL
   ani listenerów.
4. Sprawdź interakcję z OrientationGate i wąskimi viewportami.
5. Dostępność: canvas aria-hidden, fokus w polu hasła, przy reduced-motion brak błysków.
6. Testy: uzupełnij vitest o czystą logikę (przełącznik, matematyka kamery, mapowanie p, wybór wariantu ruchu) i test
   smoke, że bez WebGL (jsdom) wybierana jest stara ścieżka z SVG.
7. Dopisz do CLAUDE.md krótką sekcję o scenie logowania: tokeny, przełącznik, leniwy import, zakaz wciągania three
   do głównego chunka, kontrakt wiernej zgodności z prototypem.
8. Kontrole: npm run typecheck, npm run lint, npm run test, npm run build. Wszystkie muszą przejść.
Commit.

## RAPORT KOŃCOWY (obowiązkowy)
1. Wynik dowodu zgodności wizualnej (punkt 6 kontraktu): zestawienie zrzutów i opis różnic.
2. Wynik porównania kolorów tokenów z prototypem.
3. Zmierzone czasy faz (start transition_to_dashboard, dashboard_active).
4. Rozmiar chunka three i potwierdzenie, że stara ścieżka go nie ładuje.
5. Lista tego, czego nie dało się sprawdzić (np. realna płynność na GPU), i lista rzeczy do mojej ręcznej weryfikacji.
6. Jedna linia do zmiany, żeby włączyć scenę domyślnie.
NIE usuwaj docs/login-scene-prototype/ i NIE zmieniaj domyślnej wartości przełącznika, dopóki sam tego nie zatwierdzę.
Nie rób merge do main.
