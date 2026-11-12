# Prompt dla wykonawcy planu naprawczego

Wklej poniższy blok jako pierwszą wiadomość nowej sesji. W miejscu `<N>`
wpisz numer etapu. Jedna sesja = jeden etap.

---

```text
Pracujesz w repozytorium J.A.R.V.I.S. (osobisty asystent AI: React + TanStack
Start, Supabase, hosting Lovable). Właściciel jest analitykiem i Product
Ownerem, rozwija to solo; odpowiadaj po polsku, konkretnie.

ZADANIE: wykonaj ETAP <N> z docs/naprawa/PLAN_NAPRAWCZY.md. Tylko ten etap.

Dlaczego ten plan istnieje: aplikacja rosła szybko wszerz, a rdzeń agentów,
rozliczanie kosztów modeli i obsługa sekretów zostały w tyle. Celem jest
spłata tego długu bez zmiany tego, co właściciel widzi i lubi. Nie dodajemy
modułów ani funkcji. Jedyne zmiany zachowania to te, które plan opisuje
wprost.

ZANIM ZACZNIESZ
1. Przeczytaj w całości: CLAUDE.md, AGENTS.md, docs/naprawa/PLAN_NAPRAWCZY.md.
   Plan jest jedynym źródłem prawdy o zakresie; ten prompt mówi tylko, jak
   pracować.
2. Sprawdź w planie Dziennik i Rejestr usterek: co już zrobiono, co wyszło
   po drodze. Jeśli poprzedni etap nie jest odhaczony, zatrzymaj się i zapytaj.
3. Sprawdź sekcję „Co wymaga właściciela”. Jeśli Twój etap zależy od pozycji,
   która nie jest odhaczona (W2 i W3 dla etapu 5, decyzje W5 dla etapu 8),
   zrób wszystko, co od niej nie zależy, i zapytaj o resztę.
4. Uruchom npm ci, npm run typecheck, npm test, npm run lint i zapisz wynik
   jako punkt odniesienia. Jeśli coś jest czerwone przed Twoją zmianą,
   zgłoś to, zanim cokolwiek zmienisz.
5. Numery linii w planie pochodzą z commita 4260049 i mogły się przesunąć.
   Odszukaj kod po nazwach funkcji i przeczytaj go, zanim go zmienisz; jeśli
   opis w planie nie zgadza się z tym, co widzisz, wierz kodowi i napisz
   o różnicy.

JAK PRACOWAĆ
- Kolejność w etapie: najpierw test opisujący stan docelowy (albo test
  charakteryzujący stan obecny, gdy etap jest refaktoryzacją), potem zmiana.
- Małe commity, każdy z zielonymi kontrolami. Po każdym logicznym kroku
  uruchom testy dotkniętego obszaru, a przed końcem — komplet.
- Migracje bazy wchodzą na produkcję same po merge do main, niezależnie od
  wdrożenia aplikacji. Każda musi działać ze starym i z nowym kodem: najpierw
  dodawanie, usuwanie dopiero w późniejszym etapie. Nie edytuj istniejących
  plików migracji.
- Zmiany w interfejsie sprawdź w trybie HUD i Town oraz na wąskim ekranie,
  zgodnie z CLAUDE.md. Zrób zrzuty ekranu przed i po, jeśli etap dotyka UI.
- Fakty o zewnętrznych API (nazwy pól zużycia w Gemini, cache promptu
  i ceny u Anthropic, limity Supabase Realtime) sprawdź w aktualnej
  dokumentacji, nie z pamięci. Jeśli nie możesz sprawdzić, napisz to
  i oznacz założenie w kodzie i w PR.

USTERKI PO DRODZE
To najważniejsza reguła, bo plan jest długi i łatwo się w nim rozproszyć.
- Regresja, którą sam wprowadziłeś (test, typecheck, lint albo zachowanie,
  które działało przed Twoją zmianą): naprawiasz od razu, w tym samym etapie,
  zanim pójdziesz dalej. Nie wyłączasz testu, nie osłabiasz asercji, nie
  dodajesz ts-ignore ani eslint-disable, żeby przeszło.
- Usterka, która istniała wcześniej i blokuje etap: naprawiasz minimalnie,
  osobnym commitem, i wpisujesz do Rejestru usterek.
- Usterka, która istniała wcześniej i nie blokuje: tylko wpis do Rejestru
  usterek (data, miejsce, opis, etap). Nie naprawiasz jej teraz.
- Pomysł na ulepszenie spoza planu: jedna linijka w podsumowaniu dla
  właściciela. Nie realizujesz go.
- Jeśli po dwóch podejściach coś dalej nie działa, zatrzymaj się, opisz co
  sprawdziłeś i co wykluczyłeś, i zapytaj. Nie obchodź problemu.

GRANICE
- Nie zmieniaj zakresu etapu. Jeśli pozycja okazuje się większa, niż
  zakłada plan, albo wymaga decyzji produktowej, zapytaj właściciela.
- Nie dodawaj zależności bez pytania (bunfig.toml i skills-lock.json mają
  własne zasady; lockfile są dwa i oba muszą być spójne).
- Nie przepisuj historii gita na main, nie rób force push. Pracuj na gałęzi
  wskazanej w sesji; PR otwórz tylko, gdy właściciel o to poprosi.
- Nie usuwaj danych właściciela (tabele, wiersze, pliki w storage) bez jego
  wyraźnej zgody w tej sesji, nawet jeśli plan wymienia tabelę do usunięcia.
- Kontrakt wierności 3D z CLAUDE.md jest nienaruszalny: żadnych
  „uproszczeń dla wydajności” w scenach.

NA KONIEC ETAPU
1. Komplet kontroli zielony: typecheck, testy, lint bez nowych ostrzeżeń.
2. W docs/naprawa/PLAN_NAPRAWCZY.md: odhacz zrobione pola; pola niezrobione
   zostaw puste z dopiskiem dlaczego; dopisz wiersz w Dzienniku (data, etap,
   wynik kontroli, pomiary wymagane przez etap); uzupełnij Rejestr usterek.
3. Commit i push na gałąź sesji.
4. Podsumowanie dla właściciela, krótko: co się zmieniło z jego punktu
   widzenia; co sprawdziłeś i jak; czego nie udało się sprawdzić; co musi
   zrobić ręcznie (ustawienia w Supabase / Lovable / GitHub) i w jakiej
   kolejności względem merge; co trafiło do Rejestru usterek.
   Nie zaczynaj następnego etapu.
```

---

## Uwagi dla właściciela

- Etapy 0–2 rób po kolei i bez przerw między nimi: dopiero po nich budżet
  mówi prawdę, a rdzeń ma testy, na których opierają się etapy 3–4.
- Etap 5 ma dwa PR-y (kod, potem migracja). Drugi mergujesz dopiero, gdy
  po pierwszym aplikacja i wszystkie zaplanowane joby przeszły pełną dobę.
- Po etapie 6 kolejność to: 6b → 9 → 7 → 8 (uzasadnienie na końcu etapu 6b
  w planie). Numer etapu w prompcie wpisujesz dosłownie, np. `6b`.
- Jeśli sesja się urwie w połowie etapu, uruchom nową z tym samym promptem
  i numerem: wykonawca odczyta stan z odhaczonych pól i Dziennika.
