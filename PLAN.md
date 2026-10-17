# PLAN — Mózg 3D → Darwin → Fundusz → Vision AR

> Ustalony 2026-10-16. Kolejność wybrana przez właściciela. Każda sesja =
> jeden PR, który da się wdrożyć i obejrzeć sam w sobie. Odhaczaj sesje tu,
> a po wdrożeniu dopisz wpis do `TODO.md` (jak dotąd). Otwarte pytania na
> końcu pliku trzeba rozstrzygnąć PRZED sesją, która ich dotyczy.

## Jedna historia, nie cztery gadżety

Cztery moduły to jeden obieg wiedzy i jakości:

```
Vision AR ──(nowe dane: paragony, dokumenty, licznik)──┐
                                                       ▼
                         Mózg 3D  = CO J.A.R.V.I.S. WIE (wszystko z embeddingiem)
                                                       │
                         Darwin   = JAK SIĘ POPRAWIA (warianty promptów, ocena)
                                                       │
                         Fundusz  = GDZIE TO WIDAĆ W LICZBACH (P&L jako ocena)
                                                       │
                                  └──► wynik wraca do Darwina jako „fitness"
```

Wspólne zasady (z `CLAUDE.md` i dotychczasowej praktyki):

- **Liczby liczy kod, model je tylko czyta** — jak w `src/lib/markets/lessons.ts`.
  Każda statystyka (trafność, fitness, NAV) to czysta, testowana funkcja.
- **Mała próbka ≠ wniosek** — ściąganie do poziomu bazowego, minimalna liczba
  przypadków i tygodni (ten sam wzorzec co `lessons.ts`).
- **Tylko prawdziwe dane** — Town i Mózg pokazują wyłącznie realne wiersze.
- Każda nowa tabela: RLS `owner_id = auth.uid()`, migracja w `supabase/migrations`.
- Każdy nowy job/narzędzie loguje do `system_events` (Strażnik widzi błędy).
- UI: tokeny kolorów, `no-scrollbar`, container queries, sprawdzone w HUD i TOWN.
- Koszt modeli liczony przez istniejący `token_budget`.

---

## Etap 0 — fundament pod resztę (1 sesja)

Bez tego każda z kolejnych sesji kończy się „wgraj migrację ręcznie".

- [x] **S0.1** Przepięcie na `ybdyiebhtfoccbfupkjn` — potwierdzone przez właściciela 2026-10-16.
- [x] **S0.2** Workflow `db-migrations.yml` + `scripts/db-migrations.sh`
      (`check` na PR, `push` po merge, jednorazowy `baseline`), migracja
      włączająca `pg_cron` + `pg_net`. Sekret `SUPABASE_DB_URL`, baseline
      `20261016180000` i pierwszy push zrobione 2026-10-16 (oba przebiegi zielone).

---

## Etap 1 — Mózg 3D: konstelacja wiedzy + mapa bazy (4 sesje)

**Cel:** wszystko, co J.A.R.V.I.S. wie, jako galaktyka 3D: bliskie tematy =
gromady gwiazd. Pytanie w czacie rozświetla gwiazdy, z których wziął odpowiedź.
Drugi tryb tej samej sceny (pomysł właściciela, 2026-10-16): **STRUKTURA** —
tabele bazy jako planety połączone kluczami obcymi.

**Obsługa na telefonie jest wymaganiem, nie dodatkiem** — każda sesja
etapu sprawdzana na wąskim ekranie (portret) i w PWA na iPhonie.

### S1.1 — dane i rzut — **zrobione 2026-10-16**

- [x] Migracja `20261017090000_brain_points.sql`: `notes.embedding` (+ trigger
      zerujący nieaktualny wektor po zmianie treści), `brain_points`,
      `brain_clusters`, `brain_layout_runs`, RLS właściciela.
- [x] Dokument = 1 gwiazda (średnia embeddingów chunków, liczona w SQL).
- [x] `src/lib/brain/`: UMAP z odległością kosinusową (jak `<=>` w pgvector),
      PCA dla < 8 gwiazd, **wyrównanie do wczorajszego układu** (obrót,
      odbicie, skala) i **ciepły start UMAP od wczorajszych pozycji** —
      bez niego jedna nowa notatka przestawiała galaktykę (dryf ~0,75 przy
      promieniu 1), z nim ~0,07–0,10 przy 20 nowych gwiazdach,
      k-średnich na 3D (√(n/2) gromad, max 12), nazwy gromad ze słów (TF-IDF).
- [x] Pełny układ nocą: `scripts/brain-layout.ts` + `brain-layout.yml`
      (03:40) — poza aplikacją, bo UMAP to sekundy CPU, a serwer to
      Cloudflare Worker. 2000 gwiazd ≈ 7,5 s.
- [x] Nowe gwiazdy w ciągu dnia: `brain_place_new` (średnia 5 najbliższych
      sąsiadów, czysty SQL) co 10 min przez **pg_cron** + `brain_sync()` przy
      wejściu na stronę.
- [x] Nazwy gromad od Gemini jednym wywołaniem na cały układ; bez klucza
      albo przy błędzie — nazwy ze słów kluczowych.
- [x] Embedding notatki przy zapisie (widżet notatek i narzędzie
      `save_note`); reszta (MCP, stare wiersze, wspomnienia bez wektora) —
      nocny backfill.
- Zadania (`tasks`) świadomie poza Mózgiem: nie mają embeddingów i są
  krótkotrwałe; wrócić do tego, jeśli galaktyka będzie za uboga.

### S1.2 — scena WIEDZA (mobile-first) — **zrobione 2026-10-17**

- [x] Trasa `/mozg` (menu: Core → Mózg). Wszystkie gwiazdy to jedno
      wywołanie rysowania (THREE.Points z własnym shaderem), bloom,
      sterowanie orbitalne; three.js ładowany dopiero na tej stronie.
- [x] Kolor = typ (wspomnienia `--reactor`, notatki `--success`,
      dokumenty `--accent` — rozróżnialne w HUD i w TOWN, gdzie `--primary`
      = `--reactor`), jasność = świeżość, rozmiar = waga.
- [x] Wyszukiwarka bez polskich znaków (gromady też), Enter / wynik →
      przelot kamery; wyniki rozświetlone, reszta przygaszona. Etykiety gromad.
- [x] Karta szczegółów (treść, tagi, „Najbliżej w Mózgu” — 5 sąsiadów do
      tapnięcia), „Przybliż”, przejście do Notatek / Dokumentów.
      (`openDocumentBus` dotyczy wygenerowanych plików, nie wgranych
      dokumentów RAG — stąd link do `/documents`.)
- [x] **Telefon:** jeden palec = obrót, dwa = zoom i przesuwanie, podwójny
      tap = przybliż; `touch-none` na scenie; tapnięcie z tolerancją 28 px
      (mysz 14 px); karta od dołu z `safe-area-inset`, cele dotyku ≥ 44 px;
      **obraz kamery przesuwa się w górę, gdy karta jest otwarta** — inaczej
      wybrana gwiazda lądowała pod kartą; DPR ≤ 1,5, bloom wyłączany przy
      spadku FPS; pole wyszukiwania 16 px (iOS nie przybliża strony).
- [x] Widok **LISTA** (gromady → elementy, ten sam stan wyszukiwania i ta
      sama karta); jedyny tryb na urządzeniach bez WebGL.
- [x] Pusty Mózg i błąd ładowania — z wyjaśnieniem i przejściem do
      Notatek / Dokumentów.
- [x] Sprawdzone na zrzutach (Playwright, makieta z 600 gwiazdami):
      telefon 390 px w HUD i TOWN, lista, pusty stan, desktop 1440 px; bez
      poziomego przewijania; tap w pustkę zamyka, tap w gwiazdę otwiera kartę.

### S1.3 — Mózg żyje — **zrobione 2026-10-17**

- [x] **Ślad RAG:** `recall` i `search_documents` zapisują, po które gwiazdy
      sięgnęły (`brain_traces`); `/mozg` słucha przez Realtime — z rdzenia
      w środku galaktyki wyrastają promienie do tych gwiazd, reszta gaśnie.
      Lista ostatnich śladów do odtworzenia; pytanie można zadać prosto
      z panelu (idzie tą samą drogą co czat). Ślady > 30 dni sprząta pg_cron.
- [x] **`recall` przeszukuje też notatki** (`match_notes` + po słowach) —
      wcześniej J.A.R.V.I.S. w ogóle nie widział treści notatek.
- [x] **Oś czasu:** suwak i „Odtwórz” — galaktyka rośnie od pierwszej
      gwiazdy do dziś (7 s). Dane demo mają daty rozłożone na 90 dni;
      ponowny `seed` rozkłada daty istniejących wierszy.
- [x] **Wnioski** (liczone nocą z prawdziwych embeddingów): pary do
      scalenia (≥ 95% podobieństwa), samotne gwiazdy, gromady bez notatki
      z przejściem do Notatek.
- [x] Trzy przyciski w prawym dolnym rogu (44 px), panele w tej samej
      karcie co szczegóły gwiazdy; sprawdzone zrzutami na 390 px i 1440 px.

### S1.4 — tryb STRUKTURA: mapa bazy danych — **zrobione 2026-10-17**

- [x] Przełącznik **WIEDZA / STRUKTURA** na `/mozg` — ta sama kamera,
      dotyk i karta (wspólne `sceneKit.tsx`), wybór zapamiętany.
- [x] Tabele jako planety: rozmiar = log(liczby wierszy z `pg_class.reltuples`),
      kolor = moduł (wiedza, agenci, rynki, paliwa, zadania, system), klucze
      obce jako linie, układ siłowy z kotwicami modułów — powiązane tabele
      lądują obok siebie. RLS widać w karcie i na liście (kłódka przy
      tabelach bez RLS) zamiast obwódki — na telefonie obwódka była nieczytelna.
- [x] Tap w tabelę → karta: moduł, liczba wierszy, kolumny z typami i PK,
      powiązania (tap przelatuje do sąsiedniej tabeli), polityki RLS. Źródło:
      nowe RPC `brain_schema_map()` — bez wymogu roli admin (w odróżnieniu od
      `get_public_schema_snapshot`) i bez treści polityk.
- [x] Podgląd „Pokaż moje wiersze”: 15 najnowszych **tylko przez RLS**,
      do odczytu; `user_secrets` i `push_subscriptions` wyłącznie struktura;
      kolumny wyglądające na sekret (klucze, tokeny, hasła) maskowane;
      wektory i binaria pominięte.
- [x] Przejścia: karta gwiazdy → „Pokaż w STRUKTURZE” (notatka → `notes`
      itd.), karta `notes`/`memories`/`documents` → „Gwiazdy”.
- [x] Wyszukiwarka tabel (po nazwie lub kolumnie), filtr modułów, lista
      zamiast 3D; sprawdzone zrzutami 390 px i 1440 px, HUD i TOWN.
- [x] `/schema` zostaje jako widok tabelaryczny; STRUKTURA go nie zastępuje.

**Gotowe, gdy:** widzę swoje notatki/dokumenty/wspomnienia jako gromady
z sensownymi nazwami, pytanie w czacie zapala właściwe gwiazdy, a na
telefonie jednym przełącznikiem przechodzę do mapy tabel i ich danych.

---

## Etap 2 — Darwin: agenci, którzy ewoluują (4 sesje) — **ZAPARKOWANE 2026-10-17**

> **Zaparkowane** (decyzja 2026-10-17): na razie za duży koszt tokenów
> (arena = dziesiątki wywołań modelu na wariant). Zostaje fundament S2.1,
> który nic nie kosztuje: tabele wariantów i ocen, losowanie, blokady;
> typer ma championa pokolenia 0 = dotychczasowy prompt, więc działa jak
> przed Darwinem. Przy powrocie zaczynamy od S2.2 z ustaleniami: arena na
> Gemini Flash + finał 2–3 najlepszych na modelu z produkcji, 30 dni
> historii na wariant (newsy są w bazie bez retencji, więc arena może
> odtworzyć też wydźwięk z danego dnia).

**Cel:** prompt agenta przestaje być stałym tekstem. Warianty rywalizują na
prawdziwych zadaniach, słabsze odpadają, lepsze się krzyżują i mutują.

**Co już mamy:** prompt w `agents.config.system_prompt` (czytany w
`runtime.server.ts`), test A/B typera (`ai` vs `ai_learned`) z rozliczonymi
prognozami = gotowa, obiektywna ocena.
**Uczciwie o ograniczeniu:** prognozy rozliczają się po tygodniu, więc na
żywych danych jedno pokolenie typera to ~3–4 tygodnie. Dlatego S2.2 buduje
**arenę na historii**, a dla pozostałych agentów potrzebna jest ocena od
człowieka i sędziego-modelu.

### S2.1 — warianty w runtime — **zrobione 2026-10-17**

- [x] Tabele `agent_variants` (owner_id, agent_slug, generation, parent_ids[],
      prompt, mutation_note, status `candidate|active|champion|retired`) i
      `variant_scores` (variant_id, run_id/prediction_id, score 0..1, scorer
      `outcome|arena|human|judge|cost`). Najwyżej jeden champion na agenta
      (indeks unikalny), oceny tej samej prognozy/biegu nie dublują się.
      Statystyki do losowania: RPC `agent_variant_stats`.
- [x] `agent_runs.variant_id`, `market_predictions.variant_id`.
- [x] Losowanie (`src/lib/darwin/bandit.ts`, testy): champion 80% ruchu,
      pretendenci (`active`) resztę wg Thompsona na Beta(ocen). `candidate`
      nie gra na żywo — tylko arena (S2.2).
- [x] **Sekcje zablokowane** `[[LOCK nazwa]]…[[/LOCK]]` (`prompt.ts`, testy):
      potomek nie może zmienić/usunąć/dodać blokady ani zmienić ich
      kolejności; limit 8000 znaków i najwyżej ×1,5 (+400) względem rodzica.
- [x] **Typer** jako pseudo-agent `typer`: przy pierwszej prognozie obecny
      prompt zapisuje się jako champion pokolenia 0 (po zdjęciu znaczników
      identyczny jak dotąd). Zablokowane: rola, zasady 1–2 (nie wymyślaj
      liczb, jak liczy się wynik), zasada 6 i format JSON; mutować wolno
      zasady 3–5. Ten sam wariant pisze prognozy `ai` i `ai_learned`.
- [x] **Agenci-członkowie zespołu**: runtime bierze wariant, jeśli istnieje
      (inaczej `config.system_prompt` jak dotąd). J.A.R.V.I.S. poza
      Darwinem — jego prompt to persona + kontrakty narzędzi.
- [x] Każdy błąd bazy przy losowaniu = zwykły prompt; prognozy i agenci
      działają także przed wejściem migracji.
- Na później (S2.4): gdy agent ma warianty, pole „System prompt override”
  w Agent Hub nie działa — panel laboratorium musi to pokazać.

### S2.2 — ocena (fitness)

- [ ] Typer: trafność ze ściąganiem do poziomu bazowego (wzorzec `lessons.ts`) + kalibracja (Brier), osobno per reżim rynku.
- [ ] **Arena na historii:** wariant typera odtwarza prognozy dla przeszłych
      dni z rozliczonym wynikiem — tylko z danymi, które były dostępne w
      dniu prognozy (bez zaglądania w przyszłość). Pokolenie w godzinę zamiast w miesiąc.
- [ ] Pozostali agenci: 👍/👎 pod odpowiedzią w czacie + sędzia-model z
      rubryką per agent + kara za koszt i czas (`token_budget`, latencja z `agent_runs`).

### S2.3 — ewolucja

- [ ] Nocny job (pg_cron): mutacja (model przepisuje prompt, widząc przegrane
      przypadki), krzyżowanie (sekcje dwóch najlepszych), selekcja.
- [ ] Awans na championa: **wyłącznie ręcznie** z panelu, z
      przedziałem ufności, nie samą średnią. Rollback jednym kliknięciem.

### S2.4 — laboratorium

- [ ] Panel: drzewo genealogiczne, diff promptów między wariantami,
      wyniki z przedziałami ufności, przyciski „awansuj / wycofaj".
- [ ] Town: pokój-laboratorium; agent z nowym championem dostaje znaczek pokolenia.

**Gotowe, gdy:** typer ma co najmniej jedno pokolenie z areny, które
statystycznie pobiło obecny prompt, i awansowałem je jednym kliknięciem.

---

## Etap 3 — Fundusz J.A.R.V.I.S. (3 sesje)

**Cel:** każdy „gracz" dostaje 100 000 zł na papierze i handluje według
własnych prognoz. Ranking pokazuje, komu ufać, w złotówkach, nie w procentach trafień.

**Co już mamy:** `market_quotes`, `market_predictions` (źródła `signals`,
`ai`, `ai_learned`), kursy `USDPLN`/`EURPLN` na watchliście, nocny job `market-grid`.

### S3.1 — silnik (czysta logika) — **zrobione 2026-10-17**

- [x] Tabele `fund_portfolios` (gracz + ostatnie metryki), `fund_orders`
      (zrealizowane transakcje z powodem = uzasadnieniem prognozy),
      `fund_positions`, `fund_nav_daily`. Silnik liczy CAŁĄ historię od nowa
      przy każdym przebiegu i podmienia wiersze — zmiana zasad działa wstecz
      spójnie, stan nie może się rozjechać. Baza sama odrzuca realizację
      w dniu prognozy (`executed_on > signal_on`).
- [x] Zasady (`src/lib/fund/engine.ts`, testy): start 100 000 PLN, wycena
      w PLN po USDPLN/EURPLN z bazy, **realizacja po kolejnym zamknięciu**
      (czeka na najbliższą sesję), prowizja 0,1% + połowa spreadu per klasa
      aktywów przy każdej stronie, max 20% w instrumencie, bez krótkiej
      sprzedaży i bez dźwigni, sprzedaże przed kupnami, korekty < 500 zł
      pomijane.
- [x] Prognoza → zlecenie: „wzrost” → cel 20% × pewność, „spadek” → sprzedaj
      całość, „bez zmian” → trzymaj (i anuluj czekające); nowsza prognoza
      zastępuje czekającą.
- [x] Metryki (`metrics.ts`): stopa zwrotu, max obsunięcie, Sharpe (dzienny,
      ×√365; null przy < 10 dniach), obrót, liczba transakcji, prowizje.
- [x] Gracze (`players.ts`, `fund.ts`): `ai_learned`, `ai`, `signals`,
      **koszyk „kup i trzymaj wszystko”** (po równo we wszystkie instrumenty,
      w dniu startu) i **małpa z rzutkami** (deterministyczna). Start = dzień
      pierwszej prognozy w bazie (decyzja 2026-10-17).

### S3.2 — gracze i job — **zrobione 2026-10-17**

- [x] Gracze: `ai_learned`, `ai`, `signals`, **koszyk „kup i trzymaj
      wszystko”** i **małpa z rzutkami** (uczciwe linie odniesienia).
- [x] Krok 5 „Fundusz” w `market-grid` (`scripts/markets-daily.ts`) po
      rozliczeniu prognoz: `recomputeFund` (`src/lib/fund/fund.server.ts`)
      przelicza całą historię od pierwszej prognozy (bez kopii `stale`),
      upsertuje portfele (stałe id) i podmienia zlecenia, pozycje i dzienną
      wycenę. Ranking w logu Actions. Zero tokenów.
- [x] Pasmo tolerancji: korekta < 500 zł albo < 2% portfela pomijana
      (wahania pewności 65% → 68% nie mielą prowizji); pełna sprzedaż
      zawsze przechodzi.
- [x] Sprawdzone na Postgres + PostgREST jako zalogowany użytkownik (RLS):
      dwa przebiegi z rzędu dają identyczny wynik, żadne zlecenie nie jest
      zrealizowane w dniu prognozy.
- (Po powrocie Darwina: NAV gracza = drugi fitness dla wariantów.)

### S3.3 — sala notowań — **panel zrobiony 2026-10-17**

- [x] Panel **MARKET GRID // FUNDUSZ** w `/rynki` (strona nie ma zakładek —
      panel w tym samym stylu co pozostałe): werdykt w zdaniach („AI bije
      koszyk o +1,5 pp, przegrywa z małpą…”, ostrzeżenie przy < 14 dniach),
      ranking (zwrot, wartość, obsunięcie, Sharpe, transakcje, prowizje),
      krzywe kapitału na jednej osi w PLN z linią kapitału startowego,
      pozycje i historia transakcji wybranego gracza z powodem (uzasadnienie
      prognozy). Kolory graczy ze stałych slotów `--market-1..5`, odniesienia
      linią przerywaną. Przycisk „Przelicz” (bez modelu, zero tokenów).
      Sprawdzone zrzutami: 390 px i 1280 px, HUD i TOWN, pusty stan.
- [x] **Town przebudowane pod rozbudowę** (mapa 56×44): korytarz wschodni
      i południowy, nowe skrzydła, wejście od zachodu; dotychczasowe pokoje
      bez zmian. **Parkiet giełdowy** (27×11 kratek): tablica rankingu,
      wielki ekran z krzywymi kapitału, ściana pozycji lidera, wiszący
      ticker LED, biurka traderów (monitory w kierunku dnia gracza), ring
      z posągiem — złoty byk / brązowy niedźwiedź wg wczorajszego wyniku,
      dzwon otwarcia (konfetti), wszystko z prawdziwych danych funduszu.
      Pięć pokoi **„w remoncie”** (rusztowania, pachołki, taśma, REMONT)
      czeka na kolejne moduły.
- [x] **M.E.T.R.I.C. jako trader**: zgarbiony i spocony po stracie, podskakuje
      po zysku; część spacerów kończy na parkiecie z prawdziwym wynikiem dnia.
      Rekwizyty w trybie spaceru: tablica (ranking + werdykt), posąg, dzwon,
      terminal tradera AI (ostatnie transakcje z powodem), plan rozbudowy.
- [x] **Postacie poboczne** (`townNpcs.ts` czyste + testy, `townNpcWorld.ts`):
      6 robotników w kaskach i kamizelkach (młotek, wiertarka z iskrami,
      wałek, noszenie cegieł, miarka, przerwa na kawę; fajrant po zmroku)
      i 6 traderów w kolorowych marynarkach (biurka, krzyk w ringu z
      PRAWDZIWĄ linią tickera, ekran, radość po dzwonku, garbienie w zły
      dzień). Podpisani BUD / TRD — to statyści, nie agenci.
- [x] Brief poranny: sekcja „Fundusz” — wczorajsze zmiany graczy i lider od startu.

**Gotowe, gdy:** po 2 tygodniach widzę ranking z benchmarkiem i małpą,
a każda transakcja ma zapisany powód.

> Tylko papier. Żadnego brokera, żadnych prawdziwych pieniędzy.

---

## Etap 4 — Vision AR: telefon jako skaner świata (3 sesje)

**Cel:** celujesz telefonem i dane same lądują w bazie, a potem w Mózgu.

**Co już mamy:** `VisionScanner.tsx` (kamera, przód/tył),
`vision.functions.ts` (klatka → Gemini → opis), pipeline dokumentów
(`chunking.ts`, RAG), PWA z push.

### S4.1 — tryby i strukturalny odczyt

- [x] Przełącznik trybu: **paragon / licznik auta / dokument / lodówka / dowolne**
      (`src/lib/vision/modes.ts`; ostatni wybór pamiętany na urządzeniu).
- [x] Każdy tryb = schemat JSON, który model wypełnia (Gemini w trybie JSON,
      `responseSchema`), luźna odpowiedź → szkic (`normalize*`), zapis tylko po
      ścisłym zodzie (`SCAN_SCHEMAS`). Paragon: sklep, data, suma, waluta,
      pozycje z ilością (3 miejsca — towar na wagę), kwotą i kategorią.
- [x] **Ekran potwierdzenia** przed zapisem (`ScanConfirm.tsx`): pola do
      poprawienia, pozycje paragonu zwinięte, ostrzeżenia (suma ≠ pozycje,
      brak daty, data z przyszłości). Nic nie zapisuje się „w ciemno".
- [x] Zdjęcia w prywatnym buckecie `scans` przez **30 dni** (`vision_scans.
  photo_expires_at`); po terminie serwer kasuje plik przy kolejnym zapisie,
      dane zostają. Zdjęcie można też nie zachowywać (checkbox).
- [x] Dodatkowo: **FOTO** — skan zdjęcia z galerii (paragon zrobiony
      wcześniej), `edited_fields` — ile pól trzeba było poprawić (jakość OCR).

### S4.2 — gdzie trafiają dane

- [x] Paragon → nowy mini-moduł **Wydatki** (`expenses`, `expense_items`,
      strona `/wydatki`): „Zapisz” na paragonie od razu dodaje wydatek (jeden
      skan = jedno kliknięcie). Suma miesiąca vs poprzedni, podział na
      kategorie (reszta, której pozycje nie tłumaczą, idzie do „Inne”, więc
      części sumują się do całości), trend 6 miesięcy, lista paragonów z
      pozycjami, zdjęciem (30 dni) i usuwaniem. Sumy tylko w PLN, inne waluty
      osobno.
- [ ] Licznik → `vehicle_log` (przebieg, litry) + ceny z `/paliwa` =
      **realny koszt kilometra**.
- [ ] Dokument → istniejący pipeline RAG (→ gwiazda w Mózgu).
- [ ] Lodówka → przepis (bez zapisu albo jako notatka).

### S4.3 — prawdziwe AR

- [ ] Tryb na żywo: klatka co N sekund, model zwraca ramki obiektów,
      HUD rysuje je na wideo z etykietami (kolory z tokenów).
- [ ] Głos: „J.A.R.V.I.S., zeskanuj paragon" (istniejąca globalna komenda).
- [ ] Test na iPhonie w trybie PWA (kamera w standalone).

**Gotowe, gdy:** paragon zeskanowany telefonem pojawia się w Wydatkach
po jednym potwierdzeniu, a dokument w Mózgu jako nowa gwiazda.

---

## Harmonogram (w sesjach, nie w datach)

| Sesja    | Co        | Efekt do obejrzenia                 |
| -------- | --------- | ----------------------------------- |
| S0       | fundament | migracje same w bazie               |
| S1.1–1.4 | Mózg 3D   | galaktyka, ślad RAG, mapa bazy      |
| S2.1–2.4 | Darwin    | warianty, arena, laboratorium       |
| S3.1–3.3 | Fundusz   | ranking z benchmarkiem i małpą      |
| S4.1–4.3 | Vision AR | paragon/licznik/dokument z telefonu |

Razem ~15 sesji. Fundusz (S3.1) może ruszyć równolegle z Darwinem, bo
silnik nie zależy od wariantów; łączą się dopiero w S3.2.

## Decyzje (2026-10-16)

1. Mózg 3D pod osobną trasą **`/mozg`**.
2. Awans championa w Darwinie **wyłącznie ręcznie** z panelu laboratorium.
3. Fundusz: **jeden portfel** (akcje, indeksy, surowce, krypto razem),
   100 000 PLN, bez krótkiej sprzedaży.
4. Paragony → **nowy mini-moduł Wydatki** (`expenses`, `expense_items`).
5. Zgoda na zależność **`umap-js`**.
