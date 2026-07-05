# Fix: ekran logowania ucięty na telefonie (landscape)

## Przyczyna
1. Dotychczasowe poprawki mobilne używały klas opartych o **szerokość** ekranu (`max-md`, czyli < 768 px). Telefon w orientacji poziomej ma szerokość ~800–1900 px, więc te klasy w ogóle nie działają — strona renderuje się jak na desktopie (wielki reaktor + duży formularz).
2. Kontener logowania ma `overflow-hidden` i centrowanie w pionie — gdy zawartość jest wyższa niż ekran (~380–440 px wysokości w landscape), góra i dół są **trwale obcinane** bez możliwości przewinięcia.

## Rozwiązanie
Skalowanie oparte o **wysokość ekranu**, nie szerokość:

1. **StarkLogin.tsx**
   - Zamienić `overflow-hidden` + sztywne centrowanie na kontener, który przy niskich ekranach pozwala przewinąć zawartość (bezpiecznik), ale przede wszystkim tak zmniejsza elementy, żeby wszystko się mieściło bez scrolla.
   - Dodać w CSS wariant dla niskich ekranów (np. `@media (max-height: 500px)`): mniejsze odstępy, mniejsze pola, mniejsze przyciski, mniejszy nagłówek.
   - Na bardzo niskich ekranach ułożyć reaktor i formularz **obok siebie** (rząd zamiast kolumny) — reaktor po lewej, formularz po prawej — dzięki temu wszystko mieści się w 100dvh bez ucinania.

2. **ArcReactorTriangle.tsx**
   - Skalować rozmiar reaktora względem wysokości (`vh`) na niskich ekranach, np. `w-[min(30vh,180px)]`, zamiast obecnych wartości opartych o szerokość.

3. **Weryfikacja**
   - Test w Playwright na viewportach: 384×706 (portret), 800×360 i 915×412 (landscape telefonu), 1280×800 (desktop) — screenshot każdego, potwierdzenie że przycisk "Continue with Google" i "Forgot cipher?" są w pełni widoczne bez scrolla.

## Szczegóły techniczne
- Nowy custom variant Tailwind v4 w `src/styles.css`: `@custom-variant short (@media (max-height: 500px))` — pozwala pisać `short:...` w klasach.
- Zasada na przyszłość (zapiszę w pamięci projektu): każdy element UI skalujemy zarówno pod szerokość, jak i **wysokość** viewportu (telefon landscape), z awaryjnym scrollowaniem zamiast `overflow-hidden`.