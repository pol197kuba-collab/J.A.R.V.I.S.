## Goal
Przekształcić obecny płaski (2D) komponent `ReactorCore` w trójwymiarowy holograficzny żyroskop z prawdziwą głębią Z, wielowymiarowymi orbitami pierścieni i efektem szklanej sfery.

## Zakres zmian
Edycja tylko warstwy prezentacji — bez zmian w logice, danych ani routingu.

### Pliki do modyfikacji
- `src/components/jarvis/ReactorCore.tsx` — restrukturyzacja warstw na rzecz 3D.
- `src/styles.css` — nowe keyframes 3D + utility klasy.

## Implementacja

### 1. Przestrzeń 3D (kontener)
Nowy zewnętrzny wrapper z:
- `perspective: 1200px`
- wewnętrzny "stage" z `transform-style: preserve-3d` i `transform: rotateX(25deg) rotateY(-15deg)`
- delikatna animacja kołysania (`@keyframes gyro-tilt` — oscylacja ±5° na X/Y w 12s) dla efektu "żyjącego" hologramu.

### 2. Przejście pierścieni z SVG na warstwy DOM 3D
SVG nie pozwala umieścić elementów na różnych głębokościach Z w tym samym viewBox. Rozwiązanie: każdy pierścień staje się osobnym `<div>` (absolute, full-size) zawierającym pojedyncze `<svg>` z jego geometrią. Każdy div ma własny `translateZ` i własną animację 3D.

Rozkład Z i osi:
- Ring 1 (zewnętrzny dashed): `translateZ(-80px)`, anim `ring3d-a` — rotateX(45deg) + rotateZ 360°/28s
- Ring 2 (tick marks): `translateZ(-40px)`, anim `ring3d-b` — rotateX(-30deg) rotateY(45deg) + rotateZ -360°/22s
- Ring 3 (dotted, pionowy globus): `translateZ(0)`, anim `ring3d-c` — rotateY 360°/18s (pełny obrót osi Y)
- Ring 4 (segmented arcs): `translateZ(20px)`, anim `ring3d-d` — rotateX(60deg) rotateZ 360°/15s
- Ring 5 (inner notched): `translateZ(45px)`, anim `ring3d-e` — rotateY(-360°)/12s wokół osi X(70deg)
- Ring 6 (innermost): `translateZ(70px)`, anim `ring3d-f` — rotateZ 360°/8s z rotateX(20deg)

Każda animacja ma `transform-style: preserve-3d` i utrzymuje stałe pochylenie + dokłada obrót.

### 3. Wireframe szklanej sfery
Dodatkowa warstwa: 6–8 cienkich okręgów (divy z `border-radius: 50%`, cienki cyan border 0.5px, opacity 0.15) ustawionych na różnych kątach `rotateY(0/30/60/90/120/150)` aby utworzyć siatkę południków sfery. + 3 równoleżniki (rotateX 0/45/-45). Wszystkie wewnątrz wspólnego kontenera animowanego powolnym `spin Y 40s` żeby cała "kula" lekko się obracała.

### 4. Rdzeń (core glow)
Zachować obecny core, ale umieścić go na `translateZ(0)` z większym blurem i `mix-blend-mode: screen` na kontenerze, by przecięcia pierścieni rozjaśniały punkty styku.

### 5. Glow / blend
- Wrapper warstwy pierścieni: `mix-blend-mode: screen`
- Zwiększyć drop-shadow do `drop-shadow(0 0 12px amber) drop-shadow(0 0 28px amber/0.6)`
- Audio-reactive `glowBoost` skaluje intensywność drop-shadow oraz lekko wzmacnia `translateZ` zewnętrznego pierścienia (oddychanie sfery).

### 6. Zachowanie istniejących elementów
- Crosshair axes, coordinates, particle cloud, scanline, audio-reactive halo — pozostają (rysowane na warstwie 2D nad/pod sferą bez preserve-3d, żeby tekst był czytelny i nie obracał się z bryłą).
- `useAudioLevel`, `useCoord` hooki — bez zmian.

## Walidacja
- typecheck (`tsgo`)
- wizualnie: Playwright screenshot strony `/` po zalogowaniu — potwierdzić widoczne pochylenie 3D, pierścienie na różnych głębokościach, efekt globusa Ring 3.

## Nie zmieniam
- palety, fontów, layoutu HUD, tranzycji, sidebara, innych komponentów.
