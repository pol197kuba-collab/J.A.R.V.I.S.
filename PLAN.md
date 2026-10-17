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

### S1.4 — tryb STRUKTURA: mapa bazy danych

- [ ] Przełącznik **WIEDZA / STRUKTURA** na `/mozg` — ta sama scena, kamera
      i obsługa dotyku, inny zestaw obiektów.
- [ ] Tabele jako planety: rozmiar = liczba wierszy (`pg_class.reltuples`),
      kolor = obszar modułu (rynki, paliwa, agenci, wiedza…), obwódka = RLS
      włączone/wyłączone. Klucze obce jako linie; układ siłowy (force-directed),
      powiązane tabele lądują obok siebie.
- [ ] Tap w tabelę → karta: kolumny, typy, klucze, polityki RLS (źródło:
      istniejące RPC `get_public_schema_snapshot` z `/schema`).
- [ ] Podgląd danych: pierwsze wiersze **tylko przez RLS** (czyli wyłącznie
      dane właściciela), tylko do odczytu; tabele z sekretami
      (`user_secrets`, `push_subscriptions`) bez podglądu, wyłącznie struktura.
- [ ] Przejście między trybami: gwiazda wiedzy „wie”, z której tabeli
      pochodzi (np. notatka → planeta `notes`).
- [ ] `/schema` zostaje jako widok tabelaryczny; STRUKTURA go nie zastępuje.

**Gotowe, gdy:** widzę swoje notatki/dokumenty/wspomnienia jako gromady
z sensownymi nazwami, pytanie w czacie zapala właściwe gwiazdy, a na
telefonie jednym przełącznikiem przechodzę do mapy tabel i ich danych.

---

## Etap 2 — Darwin: agenci, którzy ewoluują (4 sesje)

**Cel:** prompt agenta przestaje być stałym tekstem. Warianty rywalizują na
prawdziwych zadaniach, słabsze odpadają, lepsze się krzyżują i mutują.

**Co już mamy:** prompt w `agents.config.system_prompt` (czytany w
`runtime.server.ts`), test A/B typera (`ai` vs `ai_learned`) z rozliczonymi
prognozami = gotowa, obiektywna ocena.
**Uczciwie o ograniczeniu:** prognozy rozliczają się po tygodniu, więc na
żywych danych jedno pokolenie typera to ~3–4 tygodnie. Dlatego S2.2 buduje
**arenę na historii**, a dla pozostałych agentów potrzebna jest ocena od
człowieka i sędziego-modelu.

### S2.1 — warianty w runtime

- [ ] Tabele `agent_variants` (owner_id, agent_slug, generation, parent_ids[],
      prompt, mutation_note, status `candidate|active|champion|retired`) i
      `variant_scores` (variant_id, run_id/prediction_id, score, scorer, created_at).
- [ ] `agent_runs.variant_id`, `market_predictions.variant_id`.
- [ ] Runtime losuje wariant: champion większość ruchu, pretendenci resztę
      (Thompson sampling — czysta funkcja, testy).
- [ ] **Sekcje zablokowane:** persona, kontrakty narzędzi i zasady
      bezpieczeństwa są poza mutacją (znaczniki w prompcie), limit długości.

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

### S3.1 — silnik (czysta logika)

- [ ] Tabele `fund_portfolios` (gracz: źródło prognozy / wariant Darwina /
      benchmark), `fund_orders`, `fund_positions`, `fund_nav_daily`.
- [ ] Zasady: jeden wspólny portfel na gracza, start 100 000 PLN, wycena w PLN po kursie z watchlisty,
      **realizacja po kolejnym zamknięciu** (nigdy po cenie, którą prognoza już znała),
      prowizja + spread, max 20% portfela w jednym instrumencie, na start bez krótkiej sprzedaży.
- [ ] Prognoza → zlecenie: kierunek + pewność → wielkość pozycji.
- [ ] Metryki: stopa zwrotu, max drawdown, Sharpe, obrót (wszystko testowane).

### S3.2 — gracze i job

- [ ] Gracze: `signals`, `ai`, `ai_learned`, champion Darwina,
      **benchmark kup-i-trzymaj** (WIG20 ETF / SPX) oraz **małpa z rzutkami**
      (losowe zlecenia), czyli uczciwa linia odniesienia.
- [ ] Krok w `market-grid` po zapisaniu prognoz; wynik dzienny → `fund_nav_daily`.
- [ ] NAV gracza = drugi fitness dla Darwina (zamyka obieg).

### S3.3 — sala notowań

- [ ] Zakładka FUNDUSZ w `/rynki`: ranking, krzywe kapitału, historia transakcji z uzasadnieniem.
- [ ] Town: parkiet; nastrój agenta z realnej zmiany NAV (spadek → zgarbiony).
- [ ] Brief poranny: linijka „wczoraj w funduszu".

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

- [ ] Przełącznik trybu: **paragon / licznik auta / dokument / lodówka / dowolne**.
- [ ] Każdy tryb = schemat JSON, który model wypełnia (zod waliduje).
- [ ] **Ekran potwierdzenia** przed zapisem: pola do poprawienia, nic nie
      zapisuje się „w ciemno".
- [ ] Zdjęcia w prywatnym buckecie Storage, z okresem przechowywania.

### S4.2 — gdzie trafiają dane

- [ ] Paragon → nowy mini-moduł **Wydatki** (`expenses`, `expense_items`,
      prosta strona z listą i sumami miesięcznymi).
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
