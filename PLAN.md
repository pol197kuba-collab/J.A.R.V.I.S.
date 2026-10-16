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

- [ ] **S0.1** Domknąć przepięcie na `ybdyiebhtfoccbfupkjn` (sekcja 0 w `TODO.md`).
- [ ] **S0.2** Workflow `supabase db push` po merge do `main` (Supabase CLI +
      sekret `SUPABASE_ACCESS_TOKEN`), włączone `pg_cron` + `pg_net`.
      Kryterium: migracja z PR-a ląduje w bazie bez SQL editora.

---

## Etap 1 — Mózg 3D: konstelacja wiedzy (3 sesje)

**Cel:** wszystko, co J.A.R.V.I.S. wie, jako galaktyka 3D: bliskie tematy =
gromady gwiazd. Pytanie w czacie rozświetla gwiazdy, z których wziął odpowiedź.

**Co już mamy:** `memories.embedding` i `document_chunks.embedding`
(vector(768), Gemini), three.js + `@react-three/fiber/drei/postprocessing`,
`useThemeColors` dla kolorów w canvasie.
**Czego brakuje:** embeddingów notatek (`notes` nie ma kolumny), rzutu 768→3D,
klastrów i śladu RAG z runtime'u.

### S1.1 — dane i rzut
- [ ] Migracja: `notes.embedding vector(768)` + backfill (best-effort, jak `remember`).
- [ ] Tabela `brain_points` (owner_id, source_type `memory|document|note|task`,
      source_id, x, y, z, cluster_id, label, created_at) + `brain_clusters`
      (id, nazwa, liczność, centroid).
- [ ] Dokumenty reprezentowane centroidem chunków (1 gwiazda = 1 dokument),
      żeby liczba punktów została w tysiącach, nie dziesiątkach tysięcy.
- [ ] `src/lib/brain/projection.ts` — UMAP (`umap-js`, **nowa zależność, do
      akceptacji**) + k-means na embeddingach; czysta logika, testy.
- [ ] Pełne przeliczenie nocą (pg_cron), nowe elementy w ciągu dnia
      wstawiane jako średnia pozycji k najbliższych sąsiadów (bez przeliczania całości).
- [ ] Nazwy klastrów: jedno tanie wywołanie modelu na klaster, cache do zmiany składu.

### S1.2 — scena
- [ ] Trasa (patrz pytanie 1) z R3F: instanced points, bloom, orbit/fly controls.
- [ ] Kolor = typ źródła (tokeny `--primary`, `--accent`, `--reactor`, `--success`),
      jasność = świeżość/ważność (`importance`), rozmiar = liczba odwołań.
- [ ] Hover → podpis; klik → otwiera notatkę/dokument (istniejący `openDocumentBus`).
- [ ] Wyszukiwarka → kamera przelatuje do gwiazdy. Etykiety klastrów w przestrzeni.
- [ ] Mobile: limit punktów, niższy DPR, dotykowe sterowanie.

### S1.3 — Mózg żyje
- [ ] **Ślad RAG:** runtime publikuje id trafień z `recall`/wyszukiwania
      dokumentów (Realtime Broadcast) → gwiazdy rozbłyskują i łączą się
      liniami z rdzeniem, gdy J.A.R.V.I.S. odpowiada.
- [ ] Suwak czasu: jak mózg rósł (po `created_at`).
- [ ] Panel „Wnioski": sieroty (gwiazdy bez sąsiadów), gęste klastry bez
      notatki-podsumowania, duplikaty (podobieństwo > 0.95) do scalenia.
- [ ] Wygląd w trybie TOWN.

**Gotowe, gdy:** widzę swoje notatki/dokumenty/wspomnienia jako gromady
z sensownymi nazwami, a pytanie w czacie zapala właściwe gwiazdy.

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
- [ ] Typer: trafność ze ściąganiem do poziomu bazowego (wzorzec `lessons.ts`)
      + kalibracja (Brier), osobno per reżim rynku.
- [ ] **Arena na historii:** wariant typera odtwarza prognozy dla przeszłych
      dni z rozliczonym wynikiem — tylko z danymi, które były dostępne w
      dniu prognozy (bez zaglądania w przyszłość). Pokolenie w godzinę zamiast w miesiąc.
- [ ] Pozostali agenci: 👍/👎 pod odpowiedzią w czacie + sędzia-model z
      rubryką per agent + kara za koszt i czas (`token_budget`, latencja z `agent_runs`).

### S2.3 — ewolucja
- [ ] Nocny job (pg_cron): mutacja (model przepisuje prompt, widząc przegrane
      przypadki), krzyżowanie (sekcje dwóch najlepszych), selekcja.
- [ ] Awans na championa: **wymaga mojej zgody** (patrz pytanie 2), z
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
- [ ] Zasady: start 100 000 PLN, wycena w PLN po kursie z watchlisty,
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
- [ ] Paragon → nowy mini-moduł **Wydatki** (`expenses`, `expense_items`) —
      patrz pytanie 4.
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

| Sesja | Co | Efekt do obejrzenia |
|---|---|---|
| S0 | fundament | migracje same w bazie |
| S1.1–1.3 | Mózg 3D | galaktyka + ślad RAG |
| S2.1–2.4 | Darwin | warianty, arena, laboratorium |
| S3.1–3.3 | Fundusz | ranking z benchmarkiem i małpą |
| S4.1–4.3 | Vision AR | paragon/licznik/dokument z telefonu |

Razem ~14 sesji. Fundusz (S3.1) może ruszyć równolegle z Darwinem, bo
silnik nie zależy od wariantów; łączą się dopiero w S3.2.

## Otwarte pytania (rozstrzygnąć przed sesją, której dotyczą)

1. **[S1.2] Gdzie Mózg?** Osobna trasa `/mozg` (rekomendacja) czy tryb
   sceny na `/jarvis` obok reaktora?
2. **[S2.3] Awans championa:** ręcznie z panelu (rekomendacja) czy automatycznie
   po przekroczeniu progu istotności?
3. **[S3.1] Fundusz:** 100 000 PLN, bez shortów, krypto w tym samym portfelu
   co akcje (rekomendacja), czy osobne ligi?
4. **[S4.2] Wydatki:** budujemy nowy mini-moduł pod paragony, czy na razie
   paragon → notatka/CSV?
5. **[S1.1] Nowa zależność `umap-js`:** zgoda? (alternatywa: PCA bez
   zależności, ale gromady wychodzą dużo mniej czytelne).
