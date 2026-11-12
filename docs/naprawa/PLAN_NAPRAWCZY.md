# Plan naprawczy J.A.R.V.I.S.

> Ustalony 2026-11-11 po rewizji kodu (stan: commit `4260049`, 981 testów zielonych,
> typecheck czysty, lint 0 błędów / 15 ostrzeżeń).
>
> **Cel:** spłacić dług techniczny i wyprostować to, co już jest.
> **Nie wprowadzamy nowych modułów ani funkcji.** Zmiana widoczna dla właściciela
> jest dopuszczalna tylko tam, gdzie plan mówi o niej wprost (np. potwierdzanie
> akcji narzędzi).
>
> Jak z tym pracować: `docs/naprawa/PROMPT_WYKONAWCY.md`.

## Zasady wspólne

1. **Jeden etap = jeden PR do `main`**, który da się wdrożyć sam. Etapy idą po
   kolei; wyjątki są zapisane przy etapie.
2. `main` jest zsynchronizowany z Lovable (`AGENTS.md`): bez przepisywania
   historii, gałąź zawsze w stanie działającym.
3. Migracje wchodzą do bazy same po merge (`db-migrations.yml`), a wdrożenie
   aplikacji idzie osobno. Dlatego każda migracja musi działać ze **starym
   i nowym** kodem: najpierw dodajemy (kolumna, tabela, funkcja), kod przechodzi
   na nowe, usuwanie starego dopiero w następnym etapie.
4. Przed każdym PR: `npm run typecheck`, `npm test`, `npm run lint` — bez
   nowych błędów i bez nowych ostrzeżeń. Testów nie wyłączamy ani nie
   osłabiamy, żeby przeszły.
5. Zachowanie zmieniane w etapie dostaje test **przed** zmianą (test opisuje
   stan docelowy i najpierw jest czerwony) albo test charakteryzujący stan
   obecny, jeśli etap jest czystą refaktoryzacją.
6. Obowiązuje `CLAUDE.md` (tokeny kolorów, `no-scrollbar`, container queries,
   kontrakt wierności 3D, HUD i Town).
7. Po etapie: odhacz pola tutaj, dopisz wiersz w „Dzienniku” na końcu pliku
   i wpisz wszystko, co wyszło po drodze, do „Rejestru usterek”.

## Co wymaga właściciela (nie da się zrobić z kodu)

- [x] **W1. Rejestracja kont.** (potwierdzone przez właściciela 2026-11-11: zablokowana) Supabase → Authentication → Sign In / Providers →
      wyłączyć „Allow new users to sign up”. W kodzie nie ma `signUp`, ale
      endpoint Supabase jest publiczny niezależnie od interfejsu. Dotyczy też
      logowania przez OAuth (`StarkLogin.tsx:115`): nowe konto Google też jest
      rejestracją.
- [x] **W2. Którą ścieżką chodzi czat.** (sprawdzone przez właściciela 2026-11-11) SQL: `select chat_routing from
      user_settings;` — wynik wpisać tutaj: `server` (1 wiersz). Potrzebne w etapie 5.
- [x] **W3. Klucz service role na hostingu.** (potwierdzone przez właściciela 2026-11-11: ustawiony) Potwierdzić, że
      `JARVIS_SUPABASE_SERVICE_ROLE_KEY` jest ustawiony w sekretach Lovable
      (używa go moduł paliw). Bez tego etap 5 nie ruszy.
- [x] **W4. Token GitHub w Ustawieniach.** (ustawienia GitHuba sprawdzone przez właściciela 2026-11-11) Wymienić na fine-grained PAT tylko
      dla tego repo, uprawnienia: Actions (read/write) + Issues (read/write),
      nic więcej. Robi się to raz, w dowolnym momencie.
- [x] **W5. Decyzje o usunięciu modułów** — podjęte 2026-11-11, tabela w etapie 8.
- [x] **W6. Playwright** jako devDependency do testu dymnego (etap 9) — zgoda 2026-11-11.

## Etap 0 — siatka bezpieczeństwa (bez zmiany zachowania)

Bez tego kolejne etapy nie mają jak wykryć regresji w rdzeniu agentów.

- [x] Testy charakteryzujące `runOrchestrator` na zamockowanym `fetch`
      i zamockowanym kliencie bazy (wzorzec: `runtime.delegation.test.ts`).
      Minimum scenariuszy: zwykła odpowiedź bez narzędzi; jedno narzędzie
      i odpowiedź; delegacja do kolegi; wymuszony `generate_document` u Forge;
      wyczerpanie limitu iteracji; błąd dostawcy bez Groq; failover Claude →
      Gemini; pusta tura i powtórka; klasyfikator UI po turze bez narzędzi.
      Każdy sprawdza: tekst końcowy, listę wywołań narzędzi, co zapisano
      w `agent_runs` (status, tokeny, koszt).
      → `src/lib/agents/runtime.characterization.test.ts` (11 testów: 9 scenariuszy
      + failover na Groq + klasyfikator na Gemini). Znane usterki A4, A9, A20
      utrwalone jako „STAN OBECNY” — etap, który je naprawia, zmienia te asercje.
- [x] Pokrycie: `vitest --coverage` jako osobny skrypt `test:coverage`
      (bez progu w CI). Zapisać w Dzienniku pokrycie `src/lib/agents`.
- [x] `README.md`: co to jest, jak uruchomić lokalnie, lista sekretów
      (hosting, GitHub Actions, `user_secrets`), mapa workflowów i pg_cron.
      Krótko; szczegóły zostają w `CLAUDE.md`.

Gotowe, gdy: nowe testy zielone na niezmienionym kodzie produkcyjnym.

## Etap 1 — bramka narzędzi (A1, A2, A13, A21)

- [x] **A1.** W pętli narzędziowej (`runtime.server.ts`, okolice 1244–1300)
      wykonywać wyłącznie narzędzie, które było zadeklarowane w tej turze
      (`toolDeclarations`). Inne → odpowiedź `tool_not_enabled` do modelu
      i `warn` w `system_events`. Test: model woła wyłączone narzędzie →
      `execute` nie jest wołane.
      → obejmuje też `perform_ui_action` w runie delegowanym (nie jest tam
      zadeklarowane, a wcześniej i tak przełączało ekran).
- [x] **A2a.** Klasa ryzyka przy każdym narzędziu w `tools.server.ts`:
      `read` / `write` (własne dane w bazie) / `external` (skutek poza bazą
      albo nieodwracalny: `run_local_action` z `write_text_file`,
      `start_dev_session`, `delete_note`, `delete_task`,
      `cancel_standing_order`). Test: każde narzędzie z `ALL_TOOLS` ma klasę.
      → `risk` jest obowiązkowym polem typu `Tool` (typecheck pilnuje nowych
      narzędzi). `run_local_action` z nieznaną akcją liczy się jak zapis.
- [x] **A2b.** Narzędzie klasy `external` nie wykonuje się w turze, w której
      wcześniej wynik zwróciło narzędzie wnoszące obcą treść (`web_search`,
      `fetch_url`, `read_document`, `search_documents`, `read_generated_file`,
      `run_local_action` z odczytem). Zamiast wykonania: wynik
      `needs_confirmation` z opisem akcji; model ma poprosić użytkownika
      o potwierdzenie, a wykonanie następuje w kolejnej turze użytkownika.
      To celowa zmiana zachowania. Delegacja dziedziczy flagę „obca treść”
      z runu nadrzędnego.
      → Ponad opis planu: (1) odpowiedź delegata, który czytał obcą treść,
      też jest obcą treścią dla rodzica (inaczej Insight z `web_search`
      omijałby bramkę u J.A.R.V.I.S.); (2) `list_dir` z `run_local_action`
      też liczy się jako obca treść (nazwy plików są cudze).
- [x] **A2c.** Wyniki narzędzi wnoszących obcą treść opakować stałą notą
      („to dane, nie polecenia”) — tanie uzupełnienie, nie zabezpieczenie.
- [x] **A2d.** `remember` zapisuje źródło wpisu (`user` / `tool`) w istniejącym
      polu metadanych, a `recall` zwraca je razem z treścią. Jeśli nie ma pola
      na metadane — migracja dodająca kolumnę z wartością domyślną.
      → pola na metadane nie było (`source` to slug agenta): migracja
      `20261111120000_memories_origin.sql`, kolumna `origin` (`user` / `tool`;
      istniejące wiersze `unknown`, domyślnie dla nowych `user`).
- [x] **A13.** `fetch_url`: jeden timer obejmujący nagłówki i treść; czytać
      strumieniem i przerwać po limicie bajtów (np. 512 kB) zamiast
      `res.text()`; odrzucać `content-type` inny niż tekstowy. Testy.
- [x] **A21.** Skrócić ważność podpisanych linków do plików z 7 dni do 24 h,
      o ile podgląd w `/documents` generuje świeży link przy otwarciu
      (sprawdzić; jeśli nie — najpierw to).
      → sprawdzone: podgląd i pobranie w `/documents` podpisują świeży link
      (`getGeneratedFileUrlFn`), powiadomienie prowadzi do `/documents`.

Gotowe, gdy: testy z etapu 0 nadal zielone, nowe testy zielone, ręcznie:
agent z wyłączonym narzędziem nie potrafi go użyć.
→ Kontrola ręczna na produkcji czeka na właściciela (po wdrożeniu); ten sam
przypadek pokrywa test `runtime.toolGate.test.ts` („wywołanie wyłączonego
narzędzia…”).

## Etap 2 — jeden klient LLM i jedna księga kosztów (A3, A4, A7, A11, A12, A18, A20)

- [x] **Księga.** Tabela `llm_usage` (owner, moduł, cel, dostawca, model,
      tokeny wejścia / wyjścia / myślenia / cache, `cost_usd`, `run_id`
      opcjonalnie, czas), RLS właściciela. `market_model_usage` zostaje
      i dalej pilnuje dziennego limitu tokenów rynków — nie ruszamy tej logiki,
      tylko dopisujemy równoległy zapis do księgi.
      → migracja `20261111140000_llm_usage.sql` (+ kolumna `estimated` dla
      szacowanego zużycia embeddingów); rynki piszą do księgi przez
      `ModelBudget.ledger`.
- [x] **Klient.** `src/lib/ai/llm/`: jedna funkcja na dostawcę (Gemini,
      Anthropic, Groq) z jednym timeoutem, jednym retry na 429/5xx, kluczem
      Gemini w nagłówku `x-goog-api-key` (A18), odczytem pełnego zużycia —
      w tym `thoughtsTokenCount` (A11; najpierw sprawdzić w aktualnej
      dokumentacji Gemini, jak pole się nazywa i jak jest rozliczane) —
      i zapisem do księgi. Istniejące `providers/*` stają się jego częścią.
      → sprawdzone w dokumentacji Gemini 2026-11-11: `thoughtsTokenCount`,
      rozliczane po stawce wyjściowej; nagłówek `x-goog-api-key`.
      ZAŁOŻENIE: `promptTokenCount` zawiera tokeny z cache (dokumentacja nie
      mówi wprost) — koszt Gemini liczony od pełnego wejścia (zawyżenie).
      Wyjątek od „jednego retry”: tura czatu Gemini zostaje przy 3 ponowieniach
      (celowa poprawka na burze 503 z 2026-07), podgląd Vision na żywo i
      wyszukiwanie zdjęć bez ponowień (czas rzeczywisty / własny limit czasu).
- [x] **Migracja wywołań**, po jednym module na commit, każdy z testem:
      `runtime.server.ts` (pętla i klasyfikator), `tools.server.ts`
      (`web_search`), `producer.server.ts`, `documentJobs.functions.ts`,
      `brief/build.server.ts`, `fuel/news.server.ts`, `vision/*` (3 pliki),
      `brain/ask.functions.ts`, `ai/embed.ts`, moduł rynków, skrypty.
      Na końcu `grep generativelanguage.googleapis.com src scripts` zwraca
      tylko klienta, `keyCheck` i `models.functions`.
      → plus `src/lib/ai/jarvisBrain.ts` (przeglądarkowa ścieżka czatu, bez
      dostępu do księgi — usuwa ją etap 5, A8) i atrapy w testach. Doszły
      moduły spoza listy: QA i zdjęcia dokumentów, embeddingi notatek i
      dokumentów, nazwy gromad w skrypcie Mózgu.
- [x] **A4.** Run zakończony błędem zapisuje tokeny i koszt zebrane do chwili
      awarii.
- [x] **A20.** Koszt liczony per wywołanie po faktycznym modelu (Groq osobno),
      nie po modelu runu.
- [x] **A3/A12.** Budżet miesięczny liczony z księgi, sumą po stronie bazy
      (funkcja SQL albo zapytanie z paginacją — nie `select` wszystkich
      wierszy). `BudgetPanel` pokazuje podział na moduły z tych samych danych.
      → funkcja `llm_spend_by_module` (moduł × model) z przejściem: koszty
      czatu z `agent_runs` sprzed pierwszego wpisu księgi, żeby budżet nie
      spadł do zera w dniu wdrożenia. Panel: „Wg modułu” i „Wg modelu”;
      lista „Wg agenta” usunięta (księga nie zna agenta).
- [x] Cennik (`pricing.ts`): dopisać modele, które po migracji wyjdą jako
      „spoza cennika”, i zaktualizować datę weryfikacji.
      → Gemini 2.5 Flash-Lite, `gemini-embedding-001`, Groq 8B i 70B (Groq
      NIEZWERYFIKOWANY u źródła). Pozostałe modele „spoza cennika” wyjdą
      z księgi po tygodniu pracy — do dopisania w etapie 3.

Gotowe, gdy: każde wywołanie modelu w aplikacji zostawia wiersz w księdze,
a suma w panelu budżetu zgadza się z sumą księgi.
→ Suma i podziały w panelu pochodzą z tych samych wierszy funkcji bazy, więc
zgadzają się z konstrukcji. Na produkcji do potwierdzenia przez właściciela
po tygodniu (`select module, count(*), sum(cost_usd) from llm_usage group by 1`).

## Etap 3 — tańsza tura (A9, A10)

Dopiero po etapie 2, żeby efekt było widać w liczbach.

- [ ] Zapisać w Dzienniku punkt odniesienia z księgi: średnie tokeny wejścia
      na turę J.A.R.V.I.S. z ostatnich 7 dni.
      → NIE ZROBIONE: księga ruszyła z etapem 2 (2026-11-11), a wykonawca nie
      ma dostępu do produkcyjnej bazy. Zmiany etapu 3 weszły od razu (decyzja
      właściciela 2026-11-11), więc punktem odniesienia będzie okres przed
      publikacją etapu 3. Zapytanie do uruchomienia w Supabase:
      `select date_trunc('day', created_at) d, purpose, count(*), avg(tokens_input)::int,
      sum(cache_read) from llm_usage where module = 'agents' group by 1, 2 order by 1, 2;`
- [x] **Cache promptu Anthropic**: `cache_control` na bloku systemowym
      i definicjach narzędzi. Sprawdzić w aktualnej dokumentacji minimalną
      długość prefiksu i ceny zapisu do cache.
      → sprawdzone 2026-11-11: minimum 512 tokenów (modele 5.x), 1024 Sonnet 5,
      4096 Haiku 4.5; zapis ×1,25 (TTL 5 min), odczyt ×0,1, dla Opus/Sonnet
      5.5 ×0,05 (dopisane w cenniku). Ponad plan: automatyczne cache'owanie
      ogona rozmowy, żeby kroki pętli narzędziowej czytały z cache.
- [x] **Stabilny prefiks**: data i godzina wychodzą z końca promptu systemowego
      do osobnego, krótkiego bloku po części cache'owanej (dziś zmienna data
      unieważnia cache co minutę).
- [x] **Historia z serwera**: `runAgent` bierze historię z `messages` po
      `conversationId`, przycina ją do budżetu tokenów (najnowsze w całości,
      starsze odcinane), a pole `history` od klienta zostaje tylko dla
      rozmowy bez `conversationId`.
      → budżet ~6000 tokenów (`HISTORY_TOKEN_BUDGET`, `src/lib/agents/history.ts`),
      z bazy ostatnie 40 wiadomości; najnowsza zostaje zawsze.
- [x] **Klasyfikator UI** (`runtime.server.ts` ~1424): uruchamiać tylko, gdy
      wypowiedź jest krótka i pasuje do słownika komend z
      `src/lib/commands/registry.ts`; w pozostałych przypadkach pomijać.
      Testy na przypadkach opisanych w komentarzach (luźne polecenia nawigacji
      nadal działają; pytania merytoryczne nie odpalają klasyfikatora).
      → `src/lib/commands/intentGate.ts`. Słownik = wzorce z rejestru + czasowniki
      luźnych poleceń (sam rejestr dubluje regex klienta, więc nic by nie
      dawał). Ponad plan: prośba o nowy plik dalej idzie do klasyfikatora, gdy
      agent ma `queue_document_job` — inaczej ta ścieżka by zniknęła.
- [ ] Zapisać w Dzienniku ten sam pomiar po tygodniu.
      → czeka na tydzień po publikacji (to samo zapytanie co wyżej).

## Etap 4 — rozbicie rdzenia agentów (A6, A17, A19)

Czysta refaktoryzacja: testy z etapu 0 nie mogą się zmienić.

- [x] `runOrchestrator` podzielić na moduły w `src/lib/agents/runtime/`:
      przygotowanie kontekstu (agent, klucze, zespół, prompt, model, budżet);
      jedna tura modelu (wybór dostawcy, failover) — po etapie 2 to cienka
      warstwa nad klientem; wykonanie narzędzi (bramka z etapu 1, delegacja,
      wyłuskanie załączników); finalizacja (klasyfikator, tekst zastępczy,
      zapis runu, wiadomości). Funkcja główna ma zostać czytelną sekwencją
      tych kroków.
      → `runtime/context.server.ts`, `turn.server.ts`, `tools.server.ts`,
      `finalize.server.ts` (+ `classifier.server.ts`, `constants.ts`,
      `prompt.ts`, `usage.ts`, `types.ts`); `runOrchestrator` ma ~70 linii.
      Kod i komentarze przeniesione dosłownie (porównane linia po linii).
- [x] Prompt systemowy i blok zespołu przenieść do osobnego pliku jako
      nazwane sekcje (bez zmiany treści — porównać wynikowy string testem).
      → `runtime/prompt.ts`; snapshot `runtime.prompt.test.ts` zapisany przed
      przeniesieniem (prompt J.A.R.V.I.S. z zespołem, agent z własnym promptem,
      deklaracje narzędzi z i bez S.H.I.E.L.D.).
- [x] `tools.server.ts` rozbić na pliki per obszar (web, notatki, pamięć,
      zadania, projekty/dev, strażnik, lokalne, dokumenty, rynki/paliwa,
      zlecenia stałe) z jednym `index` eksportującym `ALL_TOOLS`.
      → `src/lib/agents/tools/*.server.ts` (13 plików); indeksem został
      `tools.server.ts` (to samo publiczne API, importy w aplikacji bez zmian).
- [x] Testy narzędzi zapisujących (`save_note`, `delete_note`, `create_task`,
      `update_task`, `remember`, zlecenia stałe) na zamockowanym kliencie bazy.
- [x] **A19.** Status agenta: „idle” ustawiać tylko, gdy nie ma innego runu
      `running` tego agenta (albo wyliczać status z `agent_runs` przy
      odczycie i przestać go zapisywać) — wybrać prostsze, opisać w PR.
      → pierwsza opcja: status nie jest nadpisywany (idle ani error), gdy ten
      agent ma inny run `running` z ostatnich 15 minut (okno chroni przed
      runem, który padł bez zapisu).

## Etap 5 — sekrety (A5, A8, A14)

Wymaga W2 i W3.

- [ ] **A8.** Usunąć ścieżkę przeglądarkową czatu: `askJarvis` w
      `jarvisBrain.ts` zawsze idzie przez `runAgent`; klucz znika z
      `localStorage` (także sprzątanie starego wpisu przy starcie);
      `chat_routing` przestaje być czytane. Zachować gotowe kwestie
      zastępcze, gdy serwer nie odpowiada. `speakJarvis` zostaje.
      Kolumnę `chat_routing` usunąć dopiero w etapie 8.
- [ ] **A5.** Odczyt `user_secrets` tylko po stronie serwera klientem
      service role, po weryfikacji tokenu użytkownika (jeden helper
      `getOwnerSecrets(userId)` w pliku `.server.ts`). Zapis kluczy
      z Ustawień — tą samą drogą. Skrypty w `scripts/` przechodzą na service
      role tam, gdzie czytają klucze. Potem migracja: `REVOKE SELECT, INSERT,
      UPDATE, DELETE ON user_secrets FROM authenticated`.
      Kolejność wdrożenia: najpierw kod (PR 5a), po potwierdzeniu działania
      migracja (PR 5b).
- [ ] Sprawdzić, że żadna funkcja serwerowa nie zwraca pełnego klucza
      (dziś zwracają podgląd 4 znaków — utrzymać).
- [ ] **A14.** `claude-dev.yml`: dopisać warunek na autora zdarzenia
      (właściciel repo). Repo jest prywatne, więc to pas bezpieczeństwa.

## Etap 6 — zadania w tle bez przeglądarki (A16)

- [ ] Potok dokumentów (`runDocumentJobFn`) i dogrywanie grafik
      (`enrichDocumentImagesFn`) podnoszone przez pg_cron →
      `workflow_dispatch`, tym samym wzorcem co briefing
      (`dispatch_github_workflow`): zadanie w stanie `queued` starsze niż
      1–2 min uruchamia workflow, który je wykonuje. Klient może dalej
      odpalać je od razu — kolejka jest gwarancją, nie zamiennikiem.
- [ ] Zabezpieczenie przed podwójnym wykonaniem: przejęcie zadania jednym
      `UPDATE ... WHERE status = 'queued'` (sprawdzić, czy już tak jest).
- [ ] Usunąć ratowanie porzuconych zadań z `scripts/morning-brief.ts`, gdy
      nowa droga działa tydzień bez usterek.
- [ ] Sprawdzić w logach hostingu, czy długie funkcje serwerowe są ucinane;
      wynik wpisać do Dziennika. Jeśli tak — klient przestaje odpalać potok
      sam i zostaje tylko kolejka.

## Etap 7 — odpytywanie → realtime (A15)

- [ ] Wspólny hook: subskrypcja zmian tabeli unieważnia klucz zapytania;
      `refetchInterval` zostaje jako rzadki zapas (60 s).
- [ ] Przepiąć tabele o szybkim odpytywaniu (3–8 s): `agent_runs`, `agents`,
      `system_events`, `tasks`, `notes`, `generated_files`/`document_jobs`.
      Dotyczy m.in. `/jarvis`, `/documents`, `/tasks`, `/notes`,
      `/system-logs`, `/agent-hub`, `AgentFlowTree`, `AgentOpsFeed`,
      `HudOverlay`, `TownView`.
- [ ] Jedno połączenie realtime na aplikację, kanały zamykane przy
      odmontowaniu. Sprawdzić HUD, Town i telefon.
- [ ] Wolne odpytywania (5 min i rzadziej) zostają bez zmian.

## Etap 8 — sprzątanie (A22–A25) i usunięcia zatwierdzone przez właściciela

Bezwarunkowo:

- [ ] `ActiveTasksWidget.tsx` i nieużywane eksporty z `src/data/mock.ts`.
- [ ] `public/Intro.mp4` albo `public/intro.mp4` — zostaje ten, do którego
      odwołuje się kod.
- [ ] Nieużywane komponenty `src/components/ui/*` i ich zależności
      (zweryfikować każdy `grep`-em po nazwie pliku, także importy względne;
      kandydaci: carousel, calendar, drawer, form, input-otp, resizable,
      menubar, navigation-menu, context-menu, hover-card, pagination,
      breadcrumb, aspect-ratio).
- [ ] `@types/leaflet` do `devDependencies`. Oba lockfile zaktualizowane
      (`bun.lock` dla Lovable, `package-lock.json` dla CI).
- [ ] `docs/login-scene-prototype/` (4,9 MB, zastąpiony przez
      `docs/jarvis-3d-v2/` według `CLAUDE.md`).
- [ ] `TODO.md` (130 kB): wpisy zrobione do `docs/archiwum/`, w korzeniu
      zostaje tylko to, co otwarte. `CODEX.md`: usunąć to, co powtarza
      `CLAUDE.md` / `PLAN.md`, albo zarchiwizować w całości.
- [ ] Ostrzeżenia lint (15) — naprawić albo uzasadnić komentarzem.
- [ ] Kolumna `user_settings.chat_routing` — usunąć (po etapie 5).

Decyzje właściciela z 2026-11-11 (W5):

| Moduł | Decyzja | Co obejmuje usunięcie |
|---|---|---|
| `/sub-systems` | usuń | trasa, `components/jarvis/subsystems/`, `data/subSystems.ts`, wpis w rejestrze komend i menu |
| `/schema` | usuń | trasa, `lib/schema/`, komenda `open_schema` (tryb STRUKTURA w `/mozg` zostaje) |
| `/commands` | usuń | trasa, `CommandDirectory`, `data/commandDirectory.ts` |
| `/feed` | usuń | trasa, `lib/feed/` (zostają `/system-logs` i podgląd w `/jarvis`) |
| Serwer MCP | usuń | `lib/mcp/`, trasy `mcp`, `[.mcp]`, `[.well-known]`, `@lovable.dev/mcp-js`, wtyczka w `vite.config.ts`, `.lovable/mcp` |
| Darwin w runtime | odepnij | wywołanie `chooseVariant` w orkiestratorze (kod `lib/darwin` i tabele mogą zostać uśpione) |
| Lokalny worker | usuń | `local-worker/`, narzędzie `run_local_action`, tabela `local_jobs` |
| Dev Wing | usuń | `start_dev_session`, `check_dev_session`, `lib/dev/`, `claude-dev.yml`, tabele `dev_sessions`/`projects` |
| Dane demo Mózgu | usuń | `brain-demo.yml`, `scripts/brain-demo.ts`, `lib/brain/demoSeed.ts` |

Uwagi do wykonania:

- **Dane demo Mózgu:** przed usunięciem workflowu właściciel uruchamia go raz
  z akcją `remove` (Actions → Brain Demo), inaczej wiersze z tagiem
  „demo-mozg” zostaną w bazie bez narzędzia do ich usunięcia.
- **Lokalny worker i Dev Wing:** najpierw znikają narzędzia agentów, kod
  i workflow; tabele `local_jobs`, `dev_sessions`, `projects` — osobną
  migracją po potwierdzeniu właściciela w sesji (w `projects` i `tasks.project_id`
  mogą być jego dane).
- **Serwer MCP:** trasy są generowane przez wtyczkę Vite — najpierw usunąć
  wtyczkę z `vite.config.ts`, potem pliki, inaczej wrócą przy buildzie.
- **Dev Wing:** po usunięciu `claude-dev.yml` pozycja A14 z etapu 5 odpada.

Przy każdym usunięciu: trasa, wpisy w `commands/registry.ts`, `MODULE_ITEMS`,
`MODULE_AGENT`, `cockpitMenu`, `dockWidgets`, komendy głosowe, narzędzia
agentów i ich wiersze w `tools`/`agent_tools` (migracja), testy. Tabele
z danymi właściciela usuwamy osobną migracją dopiero po jego potwierdzeniu.

## Etap 9 — testy przepływów (A26)

- [ ] Jeden test dymny w przeglądarce (Playwright jako devDependency — zgoda właściciela W6):
      logowanie kontem testowym → czat → odpowiedź → notatka widoczna
      w `/notes`. Model zamockowany na poziomie sieci.
- [ ] Próg pokrycia dla `src/lib/agents` w CI ustawiony na poziomie
      osiągniętym po etapie 4 (żeby nie spadał).

## Rejestr usterek

Wszystko, co wyjdzie po drodze i nie należy do bieżącego etapu, trafia tutaj —
nie naprawiamy „przy okazji” w tym samym PR, chyba że blokuje etap.

| Data | Gdzie | Opis | Znalezione w etapie | Naprawione w (PR) |
|---|---|---|---|---|
| 2026-11-11 | `runtime.server.ts`, koniec pętli narzędziowej | Komunikat po wyczerpaniu limitu iteracji jest po angielsku („I have completed several tool calls but ran out of orchestration cycles…”), reszta odpowiedzi jest po polsku. Utrwalony w teście charakteryzującym nr 5. | 0 | |
| 2026-11-11 | `bun.lock` | Rejestr Lovable (`europe-west*-npm.pkg.dev`) jest niedostępny z sesji Claude Code w chmurze, więc `bun install` tam nie działa. Nowe wpisy (`@vitest/coverage-v8` i zależności) mają pusty adres, czyli domyślny rejestr npm, zamiast adresu cache Lovable. Sprawdzić, czy build w Lovable przechodzi. | 0 | nie wymaga naprawy — właściciel potwierdził 2026-11-11, że build w Lovable przechodzi |
| 2026-11-11 | `src/lib/agents/models.ts` (katalog modeli) | Katalog nadal oferuje `gemini-2.0-flash`, który według forum Google wyłączono 31.03.2026; nie ma go w cenniku (koszt `null`). | 2 | |
| 2026-11-11 | build (`npm run build`) | 31 ostrzeżeń „externalized for browser compatibility”, m.in. `node:dns`/`node:net` z `tools.server.ts` i `web-push` — kod serwerowy jest w grafie importów klienta. Identycznie na `main` przed etapem 2; build przechodzi, nic z tego nie trafia do bundla przeglądarki (sprawdzone). | 2 | |
| 2026-11-11 | `src/lib/agents/pricing.ts` | Stawki Groq niezweryfikowane u źródła (strona Groq niedostępna z sesji, agregatory sprzeczne — część mówi o przejściu tych modeli na „contact sales”). Sprawdzić ręcznie na groq.com/pricing. | 2 | |
| 2026-11-11 | `src/lib/ai/llm/anthropic.ts` (`forceToolName`) | Wymuszenie narzędzia przez `tool_choice: {type: "tool"}` (F.O.R.G.E. → `generate_document`) według dokumentacji Claude API zwraca 400 na Claude Opus 5.5 i Sonnet 5.5. Agent ustawiony na te modele padnie przy wymuszeniu (potem zejdzie na Gemini). | 3 | |

## Dziennik

| Data | Etap | PR | Wynik kontroli (typecheck / testy / lint) | Uwagi, pomiary |
|---|---|---|---|---|
| 2026-11-11 | — | — | czysty / 981 zielonych / 0 błędów, 15 ostrzeżeń | stan wyjściowy |
| 2026-11-11 | 0 | #223 | czysty / 992 zielone / 0 błędów, 15 ostrzeżeń (bez nowych) | Pokrycie `src/lib/agents`: linie 40,06% (1002/2501), instrukcje 38,57%, gałęzie 33,66%, funkcje 36,09%; `runtime.server.ts` linie 80,7% / gałęzie 67,7% (bez nowych testów 73,5% / 59,0%); `tools.server.ts` linie 20,1%. Całe `src`: linie 23,46%. Mutacja kontrolna (+1 token w zapisie, klasyfikator mimo wywołań narzędzi) wywraca 10 z 11 nowych testów. |
| 2026-11-11 | 1 | #225 | czysty / 1013 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Testy z etapu 0 bez zmian w asercjach. Pokrycie `src/lib/agents`: linie 44,80% (było 40,06%), gałęzie 37,11%; `runtime.server.ts` 82,3%, `tools.server.ts` 35,9% (było 20,1%). Migracja `memories.origin` — wchodzi sama po merge; nowy kod `remember` jej wymaga, więc publikacja w Lovable PO migracji. |
| 2026-11-11 | 2 | #226 | czysty / 1046 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Pokrycie `src/lib/agents`: linie 45,33% (było 44,80%), `src/lib/ai/llm` 88,8%. Build OK, w bundlu przeglądarki brak księgi i klucza. Migracja `llm_usage` i funkcja sumująca sprawdzone na lokalnym Postgresie 16 (dwa przebiegi, przejście z `agent_runs`). Kolejność wdrożenia: migracja (sama po merge) → publikacja w Lovable. |
| 2026-11-11 | 3 | #227 | czysty / 1068 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Pomiar przed/po niewykonany (brak dostępu do bazy, księga od dziś) — zapytanie w etapie 3. Oczekiwany efekt: klasyfikator tylko dla poleceń UI (zamiast po każdej turze bez narzędzi), historia ≤ ~6000 tokenów zamiast do 30×8000 znaków, cache promptu dla agentów na Claude. |
| 2026-11-12 | 4 | (PR w toku) | czysty / 1086 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Testy z etapu 0 bez zmian. Pokrycie `src/lib/agents`: linie 51,82% (było 45,33%), `runtime/` 83,8%, `tools/` 49,8%. Ten poziom to próg dla etapu 9. |

## Załącznik: znaleziska z rewizji (skrót)

| ID | Waga | Gdzie | Co |
|---|---|---|---|
| A1 | wysoka | `runtime.server.ts:1244,1298` | wykonanie narzędzia bez sprawdzenia, czy jest włączone |
| A2 | wysoka | `tools.server.ts:238,1107,1572` | obca treść i narzędzia z efektem ubocznym w jednej pętli |
| A3 | wysoka | `budget.server.ts:26` | budżet liczy tylko `agent_runs` |
| A4 | wysoka | `runtime.server.ts:1632` | run z błędem nie zapisuje kosztu |
| A5 | wysoka | migracja `20260705210509` | sekrety jawnie, czytelne dla roli `authenticated` |
| A6 | wysoka | `runtime.server.ts:522–1656` | jedna funkcja ~1130 linii |
| A7 | średnia | 12 plików | wywołanie Gemini przepisane ręcznie |
| A8 | średnia | `jarvisBrain.ts:28,327` | druga ścieżka czatu w przeglądarce, klucz w `localStorage` |
| A9 | średnia | `runtime.server.ts:1424` | klasyfikator po każdej turze bez narzędzi |
| A10 | średnia | `runtime.functions.ts:875`, `runtime.server.ts:622` | duży kontekst bez cache |
| A11 | średnia | `runtime.server.ts:1111` | tokeny myślenia Gemini nieliczone (do weryfikacji) |
| A12 | średnia | `budget.server.ts:27` | suma bez paginacji (limit 1000 wierszy) |
| A13 | średnia | `tools.server.ts:255–264` | `fetch_url` bez limitu treści i czasu na treść |
| A14 | średnia→niska | `claude-dev.yml:22` | wyzwalanie słowem `@claude` (repo prywatne) |
| A15 | średnia | ~40 miejsc | odpytywanie co 3–8 s |
| A16 | średnia | `documentJobs.functions.ts:1` | zadania w tle odpalane z przeglądarki |
| A17 | średnia | `tools.server.ts` | 33 narzędzia w jednym pliku, mało testów |
| A18 | niska | `runtime.server.ts:1068` i in. | klucz Gemini w adresie URL |
| A19 | niska | `runtime.server.ts:778,1554` | status agenta przy równoległych runach |
| A20 | niska | `runtime.server.ts:1209,1543` | tokeny Groq po stawce Gemini |
| A21 | niska | `tools.server.ts:1988` | linki do plików ważne 7 dni |
| A22 | niska | `ActiveTasksWidget.tsx`, `ui/*` | martwy kod |
| A23 | niska | `public/` | zdublowany plik wideo |
| A24 | niska | `package.json` | rozjazdy w zależnościach, dwa lockfile |
| A25 | niska | korzeń repo | brak README, 210 kB notatek roboczych |
| A26 | niska | testy | brak testów przepływów i pomiaru pokrycia |
