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
- [x] **W7. Sekrety GitHub Actions dla jobów.** `SUPABASE_SERVICE_ROLE_KEY`
      i `JARVIS_OWNER_ID` dodane przez właściciela 2026-11-12 (wcześniej puste;
      plan pytał w W3 tylko o Lovable). Przebieg Commute Watch z 16:08 UTC
      widzi oba, błąd braku klucza zniknął.
- [ ] **W8. Potwierdzenie po W7.** Czy 2026-11-13 rano przyszedł push
      z briefingu i czy log Commute Watch z okna 6:00 jest bez ostrzeżeń.
      Wynik wpisać tutaj: `______`. Sprawdza etap 6b.
- [ ] **W9. Pomiar etapu 3.** Uruchomić w Supabase zapytanie pomiarowe
      z etapu 3 i wpisać wynik do Dziennika.

## Etap 0 — siatka bezpieczeństwa (bez zmiany zachowania)

Bez tego kolejne etapy nie mają jak wykryć regresji w rdzeniu agentów.

- [x] Testy charakteryzujące `runAgentLoop` na zamockowanym `fetch`
      i zamockowanym kliencie bazy (wzorzec: `runtime.delegation.test.ts`).
      Minimum scenariuszy: zwykła odpowiedź bez narzędzi; jedno narzędzie
      i odpowiedź; delegacja do kolegi; wymuszony `generate_document` u Forge;
      wyczerpanie limitu iteracji; błąd dostawcy bez Groq; failover Claude →
      Gemini; pusta tura i powtórka; klasyfikator UI po turze bez narzędzi.
      Każdy sprawdza: tekst końcowy, listę wywołań narzędzi, co zapisano
      w `agent_runs` (status, tokeny, koszt).
      → `src/lib/agents/runtime.characterization.test.ts` (11 testów: 9 scenariuszy + failover na Groq + klasyfikator na Gemini). Znane usterki A4, A9, A20
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
      (`web_search`), `forgeDocument.server.ts`, `documentJobs.functions.ts`,
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

- [x] `runAgentLoop` podzielić na moduły w `src/lib/agents/runtime/`:
      przygotowanie kontekstu (agent, klucze, zespół, prompt, model, budżet);
      jedna tura modelu (wybór dostawcy, failover) — po etapie 2 to cienka
      warstwa nad klientem; wykonanie narzędzi (bramka z etapu 1, delegacja,
      wyłuskanie załączników); finalizacja (klasyfikator, tekst zastępczy,
      zapis runu, wiadomości). Funkcja główna ma zostać czytelną sekwencją
      tych kroków.
      → `runtime/context.server.ts`, `turn.server.ts`, `tools.server.ts`,
      `finalize.server.ts` (+ `classifier.server.ts`, `constants.ts`,
      `prompt.ts`, `usage.ts`, `types.ts`); `runAgentLoop` ma ~70 linii.
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

- [x] **A8.** Usunąć ścieżkę przeglądarkową czatu: `askJarvis` w
      `jarvisBrain.ts` zawsze idzie przez `runAgent`; klucz znika z
      `localStorage` (także sprzątanie starego wpisu przy starcie);
      `chat_routing` przestaje być czytane. Zachować gotowe kwestie
      zastępcze, gdy serwer nie odpowiada. `speakJarvis` zostaje.
      Kolumnę `chat_routing` usunąć dopiero w etapie 8.
- [x] **A5.** Odczyt `user_secrets` tylko po stronie serwera klientem
      service role, po weryfikacji tokenu użytkownika (jeden helper
      `getOwnerSecrets(userId)` w pliku `.server.ts`). Zapis kluczy
      z Ustawień — tą samą drogą. Skrypty w `scripts/` przechodzą na service
      role tam, gdzie czytają klucze. Potem migracja: `REVOKE SELECT, INSERT,
UPDATE, DELETE ON user_secrets FROM authenticated`.
      Kolejność wdrożenia: najpierw kod (PR 5a), po potwierdzeniu działania
      migracja (PR 5b). - [x] Kod (PR 5a): helpery `readOwnerSecrets` / `writeOwnerSecrets` /
      `clearOwnerSecrets` w `src/lib/secrets/ownerSecrets.server.ts`; żaden
      klient użytkownika nie dotyka tabeli (test `runtime.secrets.test.ts`).
      Skrypty z `scripts/` czytają klucze tą samą drogą (service role ze
      zmiennych Actions — wszystkie workflowy go mają). Funkcje SQL
      czytające tabelę są SECURITY DEFINER, więc REVOKE ich nie dotknie. - [x] Migracja REVOKE (PR 5b): `20261112160000_user_secrets_service_role_only.sql`
      — `REVOKE ALL ... FROM anon, authenticated` (szerzej niż SELECT/INSERT/
      UPDATE/DELETE: Supabase nadaje też TRUNCATE/REFERENCES/TRIGGER i anon).
      Właściciel potwierdził działanie 5a 2026-11-12. Sprawdzone na lokalnym
      Postgresie 16: authenticated i anon → permission denied, funkcje
      SECURITY DEFINER i service_role działają.
- [x] Sprawdzić, że żadna funkcja serwerowa nie zwraca pełnego klucza
      (dziś zwracają podgląd 4 znaków — utrzymać). Test
      `src/lib/secrets/noKeyLeak.test.ts`; `google_cse_cx` (jawny
      identyfikator wyszukiwarki) Ustawienia pokazują w całości — celowo.
- [x] **A14.** `claude-dev.yml`: dopisać warunek na autora zdarzenia
      (właściciel repo). Repo jest prywatne, więc to pas bezpieczeństwa.

## Etap 6 — zadania w tle bez przeglądarki (A16)

- [x] Potok dokumentów (`runDocumentJobFn`) i dogrywanie grafik
      (`enrichDocumentImagesFn`) podnoszone przez pg_cron →
      `workflow_dispatch`, tym samym wzorcem co briefing
      (`dispatch_github_workflow`): zadanie w stanie `queued` starsze niż
      1–2 min uruchamia workflow, który je wykonuje. Klient może dalej
      odpalać je od razu — kolejka jest gwarancją, nie zamiennikiem.
      Zrobione: migracja `20261112170000_document_jobs_dispatch.sql`
      (`dispatch_document_jobs`, pg_cron co minutę, najwyżej raz na 5 min
      i 40 razy na dobę), workflow `document-jobs.yml`, skrypt
      `scripts/document-jobs.ts`. Progi: `queued` > 90 s, `running` bez
      ruchu > 15 min, grafiki `pending` > 90 s bez żywego przejęcia.
- [x] Zabezpieczenie przed podwójnym wykonaniem: przejęcie zadania jednym
      `UPDATE ... WHERE status = 'queued'` (sprawdzić, czy już tak jest).
      Nie było: zadanie przejmował odczyt + UPDATE bez warunku, grafiki nie
      miały przejęcia. Teraz warunkowy UPDATE (status + licznik podejść)
      i znacznik `generated_files.image_claimed_at` (wygasa po 10 min).
- [ ] Usunąć ratowanie porzuconych zadań z `scripts/morning-brief.ts`, gdy
      nowa droga działa tydzień bez usterek. Czeka: najwcześniej 2026-11-19,
      po potwierdzeniu właściciela.
- [x] Sprawdzić w logach hostingu, czy długie funkcje serwerowe są ucinane;
      wynik wpisać do Dziennika. Jeśli tak — klient przestaje odpalać potok
      sam i zostaje tylko kolejka.
      (2026-11-13: tak — przebieg zginął z zamknięciem aplikacji, dane z bazy.
      Aplikacja prosi teraz o job w tle, patrz Rejestr.) Czeka na właściciela (logi Lovable —
      nie mam do nich dostępu z sesji).

## Etap 6b — poprawki po przeglądzie etapów 0–6

Dopisany 2026-11-12 po niezależnym przeglądzie stanu `main` (commit
`53461c4`). Robi się **przed etapem 7**. To naprawy tego, co już jest —
bez nowych funkcji.

**Co się stało.** Od etapu 5a klucze z `user_secrets` czyta tylko service
role, a joby w GitHub Actions logowały się kontem właściciela (e-mail
i hasło), bo sekrety `SUPABASE_SERVICE_ROLE_KEY` i `JARVIS_OWNER_ID` były
puste. Skutek: Commute Watch od 5a nie miał klucza TomTom („brak klucza
TomTom” w logu z 2026-11-12 13:50 UTC), odczyt kluczy VAPID do pushy szedł
tą samą drogą, a `scripts/document-jobs.ts` (etap 6) kończyłby się błędem
przy pierwszym wywołaniu. Wszystkie te przebiegi były **zielone**, więc
nikt tego nie zauważył. Sekrety są już dodane (W7); ten etap usuwa
przyczynę, dla której awaria była niewidoczna.

- [x] **Joby głośno o braku kluczy.** W każdym skrypcie z `scripts/`
      (commute-watch, morning-brief, markets-daily, markets-live,
      brain-layout, orlen-daily, document-jobs): brak klucza albo błąd
      odczytu sekretów potrzebnych do GŁÓWNEJ pracy joba kończy go kodem
      błędu i wpisem `error` w `system_events` (S.H.I.E.L.D. to widzi).
      Zielono kończy się tylko to, co plan joba opisuje jako świadomą
      degradację (np. rynki bez klucza modelu → sama arytmetyka) — i wtedy
      z `::warning::` nazywającym, czego zabrakło. `readOwnerSecrets` ma
      rozróżniać „nie ma takiego klucza” od „nie udało się odczytać”; dziś
      oba wyglądają tak samo dla wywołującego. Testy na oba przypadki.
      Zrobione: `readOwnerSecrets` rzuca `SecretsReadError` przy nieudanym
      odczycie (brak wiersza → `data: null`); `readOwnerSecretsOrNone` tam,
      gdzie klucz jest dodatkiem (embedding notatki, newsy paliw); push
      zwraca powód `secrets_read_failed`. Joby: `src/lib/jobs/jobRun.ts`
      (`JobRun.fail` → `::error::` + `system_events`, kod 1). Klucze modeli
      z sekretów Actions zostają świadomą degradacją z `::warning::`.
- [x] **Jedna droga uwierzytelnienia jobów.** Skoro klucze wymagają service
      role, ścieżka logowania e-mailem i hasłem w skryptach jest martwym
      zapasem, który ukrył tę usterkę. Skrypty wymagają
      `SUPABASE_SERVICE_ROLE_KEY` + `JARVIS_OWNER_ID`; ścieżkę e-mail/hasło
      usunąć ze skryptów i z `env:` w workflowach. Wyjątek: jeśli któryś job
      świadomie ma działać pod RLS — zostawić i opisać w README dlaczego.
      Sekretów `JARVIS_EMAIL` / `JARVIS_PASSWORD` w GitHubie nie da się
      usunąć z kodu: po merge i jednym zielonym dniu wpisać właścicielowi
      w podsumowaniu, że może je skasować (lokalny worker ma własny `.env`
      i znika w etapie 8). Zrobione dla wszystkich skryptów (także
      `brain-demo`); żaden job nie potrzebuje RLS — wyjątków brak.
- [x] **Jedno zdanie na koniec każdego joba.** Każdy przebieg kończy się
      `::notice::` mówiącym, co zrobił albo dlaczego nic nie zrobił (np.
      „poza oknem dojazdu — nic do sprawdzenia”). Przebieg Commute Watch
      z 2026-11-12 16:08 UTC nie wypisał ani jednej linii.
- [x] **README:** tabela sekretów GitHub Actions z podziałem na wymagane
      i opcjonalne oraz co przestaje działać bez każdego z nich.
- [ ] **W8.** Odczytać logi Morning Brief i Commute Watch z 2026-11-13
      (albo najnowsze): pushe wychodzą, klucz TomTom się czyta. Jeśli nie —
      to pierwsza rzecz do naprawy w tym etapie.
      Stan 2026-11-12: logów z 13.11 jeszcze nie ma; ostatnie przebiegi po W7
      (Commute Watch 16:08 UTC, Morning Brief 12:54 UTC) zielone.
      2026-11-13: Morning Brief wystartował o 05:00 (04:00 UTC), push wyszedł
      05:00:48 („wysłano na 1 urządz.”), telefon pokazał go ok. 07:30 —
      domyślny priorytet „normal” odkładany przez Androida (Doze). Naprawione:
      urgency „high” + TTL 12 h. Ten sam przebieg: tekst „facts” mimo kluczy
      modeli — przepisanie padało po cichu; job pokazuje teraz powód (naprawa
      przyczyny po pierwszym przebiegu z powodem w logu).
- [x] **`recall` a obca treść (luka w A2d).** Wpis pamięci o pochodzeniu
      `tool` albo `unknown` zwrócony przez `recall` jest obcą treścią:
      ustawia `untrustedSeen` i dostaje notę, tak jak wynik `fetch_url`.
      Wpisy `user` — nie. Dziś `recall` zwraca pochodzenie, ale bramka A2b
      go nie czyta, więc zatruty wpis działa w następnej rozmowie bez
      potwierdzenia. Test: `recall` z wpisem `tool`, potem `delete_note`
      w tej samej turze → `needs_confirmation`.
      Uwaga: wpisy sprzed migracji mają `unknown`; sprawdzić, ile ich jest,
      i jeśli potwierdzenia byłyby przez to nagminne — zapytać właściciela,
      czy oznaczyć stare wpisy jako `user` jednorazową migracją.
      Zrobione: pole narzędzia `untrustedResult` (obcość z wyniku), test
      `runtime.recallUntrusted.test.ts`. Liczby wpisów `unknown` nie da się
      sprawdzić z sesji — zapytanie dla właściciela w podsumowaniu etapu 6b.
      Wynik 2026-11-13: 10 wpisów, wszystkie `unknown`. Właściciel: „oznacz”
      — migracja `20261113090000_memories_origin_owner.sql` (`unknown` → `user`).
- [x] **Wymuszenie narzędzia u Claude** (Rejestr, etap 3):
      `tool_choice: {type: "tool"}` zwraca 400 na Opus 5.5 / Sonnet 5.5,
      więc F.O.R.G.E. na tych modelach zawsze pada i schodzi na Gemini.
      Sprawdzić w aktualnej dokumentacji Claude API, co te modele
      przyjmują, i dobrać sposób per model w `src/lib/ai/llm/anthropic.ts`.
      Jeśli wymuszenia nie da się uzyskać — dla `generate_document` od razu
      iść na Gemini, z jednym `info` w logu zamiast błędu i failoveru.
      Dokumentacja (2026-11-12): Opus 5.5, Sonnet 5.5, Fable/Mythos 5.1–5.2
      odrzucają `any`/`tool`; zalecane `auto` + instrukcja nie gwarantuje
      wywołania. Zrobione: `acceptsForcedToolChoice`, wymuszona tura na
      Gemini z `info`; bez klucza Gemini — Claude z `auto`.
- [x] **Katalog modeli** (Rejestr, etap 2): usunąć `gemini-2.0-flash`
      i `gemini-2.0-flash-lite` z `models.ts` po sprawdzeniu u źródła, że
      są wyłączone; agent z takim modelem w bazie ma zejść na domyślny
      z ostrzeżeniem (sprawdzić, czy już tak jest).
      Nie było (404 → failover na Groq albo martwy run) — naprawione: 404 na
      modelu agenta → model domyślny z `warn` (test
      `runtime.retiredModel.test.ts`). Wpisów w katalogu NIE usunięto:
      ai.google.dev niedostępne z sesji, wyłączenia nie dało się potwierdzić
      u źródła — czeka na zrzut od właściciela albo dostęp sieci.
      2026-11-13 (sieć dopuszczona przez właściciela): strona deprecations
      Gemini API — oba wyłączone 2026-06-01; usunięte z `models.ts`.
- [x] **Stawki Groq** (Rejestr, etap 2): zweryfikować na stronie Groq;
      jeśli z sesji nadal niedostępna — poprosić właściciela o zrzut cennika.
      2026-11-12: groq.com niedostępne z sesji — prośba o zrzut w podsumowaniu.
      2026-11-13 (console.groq.com/docs/models): `llama-3.1-8b-instant`
      i `llama-3.3-70b-versatile` to teraz „Enterprise / Contact Sales” —
      publicznej stawki brak, w cenniku zostaje ostatnia publiczna (opisane);
      dopisane `openai/gpt-oss-20b` ($0,075/$0,30) i `gpt-oss-120b`
      ($0,15/$0,60). Domyślne modele Groq to Llama — możliwe, że na zwykłym
      koncie już nie działają; zmiana na gpt-oss czeka na decyzję właściciela.
      Właściciel 2026-11-13: „przestaw” — klasyfikator `openai/gpt-oss-20b`,
      awaryjna tura `openai/gpt-oss-120b`, `reasoning_effort: low` + zapas
      1024 tokenów na myślenie (console.groq.com/docs/reasoning).
- [x] **Komunikat po limicie iteracji** (Rejestr, etap 0): po polsku,
      w tonie reszty odpowiedzi.
- [x] **Porządek w planie:** pozycje Rejestru naprawione w tym etapie
      oznaczyć numerem PR.

Poza zakresem (zapisane, żeby nie robić „przy okazji”): rozbicie
`runtime.functions.ts` (1535 linii) — etap 8; testy ścieżki czatu
i głosu — etap 9.

Gotowe, gdy: job uruchomiony bez wymaganego sekretu jest czerwony
(pokazać w teście skryptu albo opisać ręczną próbę), a każdy przebieg
zostawia w logu jedno zdanie o tym, co zrobił.

**Kolejność po 6b:** najpierw etap 9, potem 7 i 8. Regresje z etapu 5
(#230–#232) złapał właściciel, nie testy — czat i ścieżka głosowa nie mają
testów, a etapy 7 i 8 dotkną tych samych miejsc.

## Etap 7 — odpytywanie → realtime (A15)

- [x] Wspólny hook: subskrypcja zmian tabeli unieważnia klucz zapytania;
      `refetchInterval` zostaje jako rzadki zapas (60 s).
      (`src/lib/realtime/liveTables.ts` — mapa tabela → klucze, licznik
      odwołań, seria zmian = jedno odświeżenie po 0,5 s; `useLiveTables.ts`.)
- [x] Przepiąć tabele o szybkim odpytywaniu (3–8 s): `agent_runs`, `agents`,
      `system_events`, `tasks`, `notes`, `generated_files`/`document_jobs`.
      Dotyczy m.in. `/jarvis`, `/documents`, `/tasks`, `/notes`,
      `/system-logs`, `/agent-hub`, `AgentFlowTree`, `AgentOpsFeed`,
      `HudOverlay`, `TownView`.
      (Plus `documents`. `document_jobs` nie jest czytane przez żadne
      zapytanie UI — postęp widać przez `generated_files`. Przepięte też
      zapytania 10–15 s na tych samych kluczach (`DesktopNav`,
      `MobileBottomNav`, `useAgentChatChannel`, `TaskBoardPanel`) — inaczej
      wspólny klucz dalej odpytywałby co 15 s. Migracja dopisuje tabele do
      publikacji `supabase_realtime`.)
- [x] Jedno połączenie realtime na aplikację, kanały zamykane przy
      odmontowaniu. Sprawdzić HUD, Town i telefon.
      (Jeden kanał na tabelę na całą aplikację, wszystkie przez jedno
      połączenie WebSocket klienta Supabase. Wygląd bez zmian; test dymny
      sprawdza, że notatka wpisana poza aplikacją pojawia się w `/notes`
      w ≤ 15 s.)
- [x] Wolne odpytywania (5 min i rzadziej) zostają bez zmian.
      (Także zbiorcze 15–20 s: `CockpitHero`, `SystemPulsePanel`, `/feed`,
      projekty — czytają tabele spoza publikacji albo agregaty.)

## Etap 8 — sprzątanie (A22–A25) i usunięcia zatwierdzone przez właściciela

Bezwarunkowo:

- [x] `ActiveTasksWidget.tsx` i nieużywane eksporty z `src/data/mock.ts`.
      (8A: `mock.ts` usunięty, `bootLogs` w `src/data/bootLogs.ts`.)
- [x] `public/Intro.mp4` albo `public/intro.mp4` — zostaje ten, do którego
      odwołuje się kod.
      (8A: kod nie odwołuje się do żadnego — oba identyczne pliki usunięte.)
- [x] Nieużywane komponenty `src/components/ui/*` i ich zależności
      (zweryfikować każdy `grep`-em po nazwie pliku, także importy względne;
      kandydaci: carousel, calendar, drawer, form, input-otp, resizable,
      menubar, navigation-menu, context-menu, hover-card, pagination,
      breadcrumb, aspect-ratio).
      (8A: 27 nieużywanych komponentów — 13 kandydatów i 14 kolejnych — oraz
      23 pakiety używane tylko przez nie. Tailwind, `router-plugin`,
      `tsconfig-paths` zostają — używane pośrednio przez CSS/Vite.)
- [x] `@types/leaflet` do `devDependencies`. Oba lockfile zaktualizowane
      (`bun.lock` dla Lovable, `package-lock.json` dla CI).
- [x] `docs/login-scene-prototype/` (4,9 MB, zastąpiony przez
      `docs/jarvis-3d-v2/` według `CLAUDE.md`).
      (8A: `reactor.js` identyczny w obu; odwołania przepięte na v2.)
- [x] `TODO.md` (130 kB): wpisy zrobione do `docs/archiwum/`, w korzeniu
      zostaje tylko to, co otwarte. `CODEX.md`: usunąć to, co powtarza
      `CLAUDE.md` / `PLAN.md`, albo zarchiwizować w całości.
      (8A: oba do `docs/archiwum/`; w korzeniu `TODO.md` z otwartymi
      pozycjami, ~11 kB.)
- [x] Ostrzeżenia lint (15) — naprawić albo uzasadnić komentarzem.
      (8A: 14 → 0 — usunięte pliki, eksporty przeniesione/ukryte, brakująca
      zależność hooka, jawna lista hooków kontekstu w `eslint.config.js`
      z uzasadnieniem. Ostatnie, w `/schema`, znika z modułem w 8B.)
- [x] Kolumna `user_settings.chat_routing` — usunąć (po etapie 5).
      (8C: migracja `20261113160000` razem z tabelami `local_jobs`
      i `dev_sessions`, po publikacji 8B — zgoda właściciela 2026-11-13.)

Decyzje właściciela z 2026-11-11 (W5):

| Moduł            | Decyzja      | Co obejmuje usunięcie                                                                                                 |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `/sub-systems`   | usuń ✓ 8B    | trasa, `components/jarvis/subsystems/`, `data/subSystems.ts`, wpis w rejestrze komend i menu                          |
| `/schema`        | usuń ✓ 8B    | trasa, `lib/schema/`, komenda `open_schema` (tryb STRUKTURA w `/mozg` zostaje)                                        |
| `/commands`      | usuń ✓ 8B    | trasa, `CommandDirectory`, `data/commandDirectory.ts`                                                                 |
| `/feed`          | usuń ✓ 8B    | trasa, `lib/feed/` (zostają `/system-logs` i podgląd w `/jarvis`)                                                     |
| Serwer MCP       | usuń ✓ 8B    | `lib/mcp/`, trasy `mcp`, `[.mcp]`, `[.well-known]`, `@lovable.dev/mcp-js`, wtyczka w `vite.config.ts`, `.lovable/mcp` |
| Darwin w runtime | odepnij ✓ 8B | wywołanie `chooseVariant` w orkiestratorze (kod `lib/darwin` i tabele mogą zostać uśpione)                            |
| Lokalny worker   | usuń ✓ 8B    | `local-worker/`, narzędzie `run_local_action`, tabela `local_jobs`                                                    |
| Dev Wing         | usuń ✓ 8B    | `start_dev_session`, `check_dev_session`, `lib/dev/`, `claude-dev.yml`, tabele `dev_sessions`/`projects`              |
| Dane demo Mózgu  | usuń ✓ 8B    | `brain-demo.yml`, `scripts/brain-demo.ts`, `lib/brain/demoSeed.ts`                                                    |

Wykonanie 8B (2026-11-13): wszystkie moduły z tabeli usunięte z kodu, menu,
Kokpitu, rejestru komend, tuneli i Town (pulpit w Town i Kokpit prowadzą do
`/system-logs` zamiast `/feed`). Komendy „monitor paliwa” / „open fuel”
prowadzą do `/paliwa`. Projekty zostają (decyzja właściciela 2026-11-13:
używa ich `/tasks`); znikają tylko `start_dev_session` / `check_dev_session`.
Migracja `20261113140000` usuwa wiersze trzech narzędzi z `tools` i podmienia
prompt D.R.O.I.D.-a (projekty i zadania zamiast zlecania kodu), o ile nie był
zmieniany ręcznie. Darwin: kod i tabele uśpione, korzysta z nich jeszcze typer
rynków. Tabele `local_jobs`, `dev_sessions` i kolumna `chat_routing` — 8C,
po publikacji 8B (zgoda właściciela 2026-11-13).

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

- [x] Jeden test dymny w przeglądarce (Playwright jako devDependency — zgoda właściciela W6):
      logowanie kontem testowym → czat → odpowiedź → notatka widoczna
      w `/notes`. Model zamockowany na poziomie sieci.
      (#242: `e2e/`, workflow `e2e.yml` na lokalnym Supabase w CI, atrapa
      Gemini przez `JARVIS_GEMINI_BASE_URL`; produkcja nietknięta.)
- [x] Próg pokrycia dla `src/lib/agents` w CI ustawiony na poziomie
      osiągniętym po etapie 4 (żeby nie spadał).
      (#242: `vitest.config.ts`, linie ≥ 51,82%; CI uruchamia `test:coverage`.)

## Rejestr usterek

Wszystko, co wyjdzie po drodze i nie należy do bieżącego etapu, trafia tutaj —
nie naprawiamy „przy okazji” w tym samym PR, chyba że blokuje etap.

| Data       | Gdzie                                                                | Opis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Znalezione w etapie | Naprawione w (PR)                                                                                                                                           |
| ---------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | `runtime.server.ts`, koniec pętli narzędziowej                       | Komunikat po wyczerpaniu limitu iteracji jest po angielsku („I have completed several tool calls but ran out of orchestration cycles…”), reszta odpowiedzi jest po polsku. Utrwalony w teście charakteryzującym nr 5.                                                                                                                                                                                                                                                                               | 0                   | naprawione w etapie 6b (#238): po polsku, `ITERATION_LIMIT_REPLY`                                                                                           |
| 2026-11-11 | `bun.lock`                                                           | Rejestr Lovable (`europe-west*-npm.pkg.dev`) jest niedostępny z sesji Claude Code w chmurze, więc `bun install` tam nie działa. Nowe wpisy (`@vitest/coverage-v8` i zależności) mają pusty adres, czyli domyślny rejestr npm, zamiast adresu cache Lovable. Sprawdzić, czy build w Lovable przechodzi.                                                                                                                                                                                              | 0                   | nie wymaga naprawy — właściciel potwierdził 2026-11-11, że build w Lovable przechodzi                                                                       |
| 2026-11-11 | `src/lib/agents/models.ts` (katalog modeli)                          | Katalog nadal oferuje `gemini-2.0-flash`, który według forum Google wyłączono 31.03.2026; nie ma go w cenniku (koszt `null`).                                                                                                                                                                                                                                                                                                                                                                       | 2                   | naprawione: #238 (model wyłączony → domyślny), 2026-11-13 usunięte z katalogu (wyłączone 2026-06-01)                                                        |
| 2026-11-11 | build (`npm run build`)                                              | 31 ostrzeżeń „externalized for browser compatibility”, m.in. `node:dns`/`node:net` z `tools.server.ts` i `web-push` — kod serwerowy jest w grafie importów klienta. Identycznie na `main` przed etapem 2; build przechodzi, nic z tego nie trafia do bundla przeglądarki (sprawdzone).                                                                                                                                                                                                              | 2                   |                                                                                                                                                             |
| 2026-11-11 | `src/lib/agents/pricing.ts`                                          | Stawki Groq niezweryfikowane u źródła (strona Groq niedostępna z sesji, agregatory sprzeczne — część mówi o przejściu tych modeli na „contact sales”). Sprawdzić ręcznie na groq.com/pricing.                                                                                                                                                                                                                                                                                                       | 2                   | sprawdzone 2026-11-13: Llama „Contact Sales”, dopisane gpt-oss; decyzja o modelach domyślnych u właściciela                                                 |
| 2026-11-11 | `src/lib/ai/llm/anthropic.ts` (`forceToolName`)                      | Wymuszenie narzędzia przez `tool_choice: {type: "tool"}` (F.O.R.G.E. → `generate_document`) według dokumentacji Claude API zwraca 400 na Claude Opus 5.5 i Sonnet 5.5. Agent ustawiony na te modele padnie przy wymuszeniu (potem zejdzie na Gemini).                                                                                                                                                                                                                                               | 3                   | naprawione w etapie 6b (#238): `acceptsForcedToolChoice`, wymuszona tura od razu na Gemini                                                                  |
| 2026-11-12 | `useAgentChatChannel.ts`, `VoiceCommandContext.tsx` (historia czatu) | Klient dopisywał wiadomość do transkryptu PRZED pobraniem historii, więc model dostawał tę samą prośbę dwa razy (historia + input) i odpowiadał „prośba padła dwa razy”. Od etapu 3 tylko przy pierwszej wiadomości w nowym/wyczyszczonym wątku i w ścieżce głosowej; wcześniej przy każdej turze. Zgłosił właściciel.                                                                                                                                                                              | 0                   | naprawione 2026-11-12: historia pobierana przed dopisaniem + `withoutCurrentInput` na serwerze (test)                                                       |
| 2026-11-12 | `runAgent` (`runtime.functions.ts`)                                  | **Regresja z etapu 5 (A8):** przepisany `askJarvis` przestał podawać `conversationId` (zniknęło `resolveConversationId`), więc od publikacji 5a każda odpowiedź drogą głosową/komend zakładała nowy wątek i czat pokazywał tylko najnowszy. Wiadomość bez `conversationId` (wysłana, zanim czat wczytał wątek; głos; zmiana agenta) zakładała NOWY wątek. Czat pokazywał potem tylko ten wątek — starej rozmowy nie dało się przewinąć. Zgłosił właściciel. Stare wątki zostają w bazie nietknięte. | 0                   | naprawione 2026-11-12: bez `conversationId` dopisujemy do ostatniego wątku agenta (test `runAgent.thread.test.ts`)                                          |
| 2026-11-12 | `useAgentChatChannel.ts` (aktywny agent)                             | Przeglądarka pamiętała slug agenta sprzed zmiany nazw (`orchestrator`); mikrofon spoza `/jarvis` wysyła od razu, zanim aplikacja wczyta wybór z konta → „Agent not found: orchestrator”. Zgłosił właściciel.                                                                                                                                                                                                                                                                                        | 0                   | naprawione 2026-11-12: zapamiętany agent sprawdzany z listą istniejących (`isAgentSlug`), nieznany → J.A.R.V.I.S. i nadpisanie wpisu                        |
| 2026-11-13 | `supabase/migrations/20260817120000_metric_analysis_expansion.sql`   | Migracja nie przechodzi na czystej bazie: `to_jsonb($$…$$)` — „could not determine polymorphic type”. Na produkcji nałożona dawno, więc nic nie psuje; pliku migracji nie wolno zmieniać. Test dymny poprawia ją tylko w kopii roboczej CI (`e2e/fix-legacy-migrations.sh`; job pada, jeśli wzorzec zniknie).                                                                                                                                                                                       | 9                   | obejście w CI (#242), plik w repo bez zmian                                                                                                                 |
| 2026-11-13 | lokalna baza testu dymnego                                           | Trigger `enforce_owner_only_signup` (W1) blokuje założenie konta testowego; w jednorazowej bazie CI funkcja jest podmieniana na przepuszczającą. Produkcja bez zmian.                                                                                                                                                                                                                                                                                                                               | 9                   | świadome obejście w CI (#242)                                                                                                                               |
| 2026-11-13 | D.R.O.I.D. (agent)                                                   | Bez Dev Wing agent prowadzi już tylko projekty i zadania; rola „Software Delivery” i opis na stronie startowej (`landingData.ts`, zatwierdzona treść) zostały bez zmian. Decyzja właściciela: zostawić, przemianować czy usunąć agenta (pokój w Town, sigil, `MODULE_AGENT`).                                                                                                                                                                                                                       | 8                   | właściciel 2026-11-13: zostaje — w przyszłości ma pisać kod modułów z poziomu J.A.R.V.I.S.-a                                                                |
| 2026-11-13 | `handle_new_user()`                                                  | Funkcja zakładania konta nadal daje nowemu kontu D.R.O.I.D.-a ze starym promptem i próbuje przypiąć usunięte narzędzia (nie znajdzie ich — bez błędu). Rejestracja jest zablokowana (W1), więc nie ma skutku; poprawić przy najbliższej zmianie tej funkcji.                                                                                                                                                                                                                                        | 8                   |                                                                                                                                                             |
| 2026-11-13 | menu modułów (`modules.ts`)                                          | Po usunięciach w grupie „Agenci” zostali Agent Hub i Situation Room. Na prośbę właściciela: Situation Room → Start, Agent Town → Agenci (obok Agent Huba) — zostają 4 grupy, czyli 4 kolumny Kokpitu.                                                                                                                                                                                                                                                                                               | 8                   | 8C                                                                                                                                                          |
| 2026-11-13 | agenci ↔ Situation Room                                              | Na „jak wygląda droga do domu” J.A.R.V.I.S. prosił o adres: agenci nie mieli żadnego narzędzia do dojazdu, choć dom, praca i klucz TomTom są w Ustawieniach. Zgłosił właściciel.                                                                                                                                                                                                                                                                                                                    | po 8                | narzędzie `check_commute` (J.A.R.V.I.S. i S.H.I.E.L.D.) + migracja `20261113180000`                                                                         |
| 2026-11-13 | `chatHistory.ts` (`toConversationMessage`)                           | Godzinę wiadomości z historii liczył serwer, który działa w UTC — po ponownym otwarciu aplikacji wiadomość z 20:22 pokazywała się jako 19:22. Zgłosił właściciel.                                                                                                                                                                                                                                                                                                                                   | po 8                | godzinę liczy klient (`localizeTime`), test ze strefą                                                                                                       |
| 2026-11-13 | `web_search` (`tools/web.server.ts`)                                 | Wyszukiwanie zawsze idzie do Gemini, ale z modelem agenta — I.N.S.I.G.H.T. na `claude-opus-5` dostawał HTTP 404 przy każdym wyszukiwaniu i zbierał materiał samym `fetch_url` po zgadywanych adresach. Zgłosił właściciel (prezentacja stała na 30%).                                                                                                                                                                                                                                               | po 8                | `groundingModel`: model agenta tylko, gdy to Gemini, inaczej domyślny                                                                                       |
| 2026-11-13 | potok dokumentów (`runDocumentJobFn`)                                | Telefon wykonywał potok I.N.S.I.G.H.T. → F.O.R.G.E. we własnym zapytaniu; zamknięcie aplikacji zabiło przebieg (insight 19:22 na zawsze „running”), kolejka wznowiła go po 15 min — prezentacja ~20 min. Potwierdzone danymi z bazy (zgłoszenie właściciela). Zamyka otwarty punkt etapu 6 („czy długie funkcje są ucinane”).                                                                                                                                                                       | 6                   | aplikacja prosi o job w tle (`request_document_jobs`), `queued` bez karencji; liczy u siebie tylko bez tła                                                  |
| 2026-11-13 | modele Gemini                                                        | `gemini-2.5-flash`/`-pro` wycofane 2026-11-02, wyłączenie 2026-12-01 (aistudio.google.com/docs/deprecations). Gemini 3.x/4.x: wycofane `temperature`/`topP`/`topK`, `thinkingLevel` zamiast `thinkingBudget`, podpisy myślenia w pętli narzędzi (bez nich HTTP 400).                                                                                                                                                                                                                                | po 8                | `geminiCompat.ts` w `callGemini`, `thoughtSignature` w historii tury, domyślny `gemini-3.8-flash`; podział mieszany agentów — osobna migracja po publikacji |
| 2026-11-13 | Ustawienia → J.A.R.V.I.S. (model)                                    | Wybór „Model J.A.R.V.I.S.-a” zmieniał model domyślny, który nie działał dla agentów z własnym modelem (J.A.R.V.I.S. miał Opus) — dwa źródła prawdy.                                                                                                                                                                                                                                                                                                                                                 | po 8                | wybór tylko w Agent Hub (decyzja właściciela)                                                                                                               |
| 2026-11-13 | `agent_runs`                                                         | Przebieg przerwany z zewnątrz (zabita funkcja) zostaje na zawsze `running` — ratownik zwalnia agenta, ale nie zamyka wiersza przebiegu.                                                                                                                                                                                                                                                                                                                                                             | po 8                |                                                                                                                                                             |

## Dziennik

| Data       | Etap     | PR             | Wynik kontroli (typecheck / testy / lint)                     | Uwagi, pomiary                                                                                                                                                                                                                                                                                                                                                |
| ---------- | -------- | -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | —        | —              | czysty / 981 zielonych / 0 błędów, 15 ostrzeżeń               | stan wyjściowy                                                                                                                                                                                                                                                                                                                                                |
| 2026-11-11 | 0        | #223           | czysty / 992 zielone / 0 błędów, 15 ostrzeżeń (bez nowych)    | Pokrycie `src/lib/agents`: linie 40,06% (1002/2501), instrukcje 38,57%, gałęzie 33,66%, funkcje 36,09%; `runtime.server.ts` linie 80,7% / gałęzie 67,7% (bez nowych testów 73,5% / 59,0%); `tools.server.ts` linie 20,1%. Całe `src`: linie 23,46%. Mutacja kontrolna (+1 token w zapisie, klasyfikator mimo wywołań narzędzi) wywraca 10 z 11 nowych testów. |
| 2026-11-11 | 1        | #225           | czysty / 1013 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Testy z etapu 0 bez zmian w asercjach. Pokrycie `src/lib/agents`: linie 44,80% (było 40,06%), gałęzie 37,11%; `runtime.server.ts` 82,3%, `tools.server.ts` 35,9% (było 20,1%). Migracja `memories.origin` — wchodzi sama po merge; nowy kod `remember` jej wymaga, więc publikacja w Lovable PO migracji.                                                     |
| 2026-11-11 | 2        | #226           | czysty / 1046 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Pokrycie `src/lib/agents`: linie 45,33% (było 44,80%), `src/lib/ai/llm` 88,8%. Build OK, w bundlu przeglądarki brak księgi i klucza. Migracja `llm_usage` i funkcja sumująca sprawdzone na lokalnym Postgresie 16 (dwa przebiegi, przejście z `agent_runs`). Kolejność wdrożenia: migracja (sama po merge) → publikacja w Lovable.                            |
| 2026-11-11 | 3        | #227           | czysty / 1068 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Pomiar przed/po niewykonany (brak dostępu do bazy, księga od dziś) — zapytanie w etapie 3. Oczekiwany efekt: klasyfikator tylko dla poleceń UI (zamiast po każdej turze bez narzędzi), historia ≤ ~6000 tokenów zamiast do 30×8000 znaków, cache promptu dla agentów na Claude.                                                                               |
| 2026-11-12 | 4        | #228           | czysty / 1086 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Testy z etapu 0 bez zmian. Pokrycie `src/lib/agents`: linie 51,82% (było 45,33%), `runtime/` 83,8%, `tools/` 49,8%. Ten poziom to próg dla etapu 9.                                                                                                                                                                                                           |
| 2026-11-12 | 5 (5a)   | #229           | czysty / 1098 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | A8, A5 (kod), A14. Z Ustawień znika przełącznik „Czat przez serwer” — czat zawsze idzie przez serwer. Migracja REVOKE (5b) dopiero po potwierdzeniu przez właściciela, że 5a działa po publikacji w Lovable.                                                                                                                                                  |
| 2026-11-12 | 5 (5b)   | #234           | czysty / 1104 zielone / 0 błędów, 15 ostrzeżeń (bez nowych)   | Migracja REVOKE na `user_secrets`. Po drodze (zgłoszenia właściciela): #230 (prośba „dwa razy”), #231 (wątek czatu — regresja z A8), #232 (nieistniejący agent; stare nazwy agentów w kodzie), #233 (narzędzia `guardian_*` → `shield_*`). Etap 5 zamknięty.                                                                                                  |
| 2026-11-12 | 6        | #235           | czysty / 1116 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | Kolejka w tle (pg_cron → `document-jobs.yml`) i warunkowe przejęcie zadań/grafik. Migracja sprawdzona na lokalnym Postgresie 16 (atrapy `net`/`cron`): wywołanie tylko przy czekającej pracy, blokada 5 min, drugi przebieg bez błędu. Otwarte: usunięcie ratownika z briefingu (po tygodniu), sprawdzenie ucinania w logach Lovable.                         |
| 2026-11-12 | przegląd | —              | czysty / 1116 zielonych / 0 błędów, 15 ostrzeżeń              | Niezależny przegląd `main` po etapach 0–6: kierunek zgodny z planem; znaleziona usterka z sekretami jobów (W7, etap 6b). Dopisany etap 6b, zmieniona kolejność: 6b → 9 → 7 → 8.                                                                                                                                                                               |
| 2026-11-12 | 6b (A)   | #237           | czysty / 1122 zielone / 0 błędów, 15 ostrzeżeń (bez nowych)   | Joby: jedna droga uwierzytelnienia, głośno o braku kluczy, zdanie na koniec; README sekretów. Ręcznie: 7 jobów bez sekretu → kod 1.                                                                                                                                                                                                                           |
| 2026-11-12 | 6b (B)   | #238           | czysty / 1129 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | recall a obca treść, wymuszenie narzędzia per model Claude, model wyłączony → domyślny, komunikat limitu po polsku. Otwarte: W8 (logi z 13.11), stawki Groq i katalog Gemini (strony poza siecią sesji), liczba wpisów `unknown`.                                                                                                                             |
| 2026-11-13 | 9        | #242           | czysty / 1134 zielone / 0 błędów, 15 ostrzeżeń (bez nowych)   | Test dymny Playwright (logowanie → czat → odpowiedź → notatka w `/notes`) na lokalnym Supabase z atrapą Gemini — zielony w CI (~3 min). Próg pokrycia `src/lib/agents` 51,82% linii w CI. Przy okazji (#241): Groq na GPT-OSS. Następny etap: 7.                                                                                                              |
| 2026-11-13 | 7        | #244           | czysty / 1141 zielonych / 0 błędów, 15 ostrzeżeń (bez nowych) | 18 zapytań z odpytywania 3–15 s na realtime + zapas 60 s. Migracja publikacji sprawdzona na lokalnym Postgresie 16 (dwa przebiegi). Test dymny z realtime (lokalny Supabase). Do sprawdzenia po publikacji: czy status agenta i dokumentów odświeża się od razu.                                                                                              |
| 2026-11-13 | 8        | #245, #246, 8C | czysty / 1138 zielonych / 0 błędów, 0 ostrzeżeń               | 8A: martwy kod, 27 komponentów `ui/*`, 24 pakiety, prototyp 3D (4,9 MB), notatki do archiwum, lint 15 → 0. 8B: 8 modułów usuniętych, Darwin odpięty, projekty zostają. 8C: tabele `local_jobs`, `dev_sessions`, kolumna `chat_routing`; menu: Situation Room w Start, Agent Town w Agentach. Plan naprawczy wykonany.                                         |

## Załącznik: znaleziska z rewizji (skrót)

| ID  | Waga          | Gdzie                                               | Co                                                         |
| --- | ------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| A1  | wysoka        | `runtime.server.ts:1244,1298`                       | wykonanie narzędzia bez sprawdzenia, czy jest włączone     |
| A2  | wysoka        | `tools.server.ts:238,1107,1572`                     | obca treść i narzędzia z efektem ubocznym w jednej pętli   |
| A3  | wysoka        | `budget.server.ts:26`                               | budżet liczy tylko `agent_runs`                            |
| A4  | wysoka        | `runtime.server.ts:1632`                            | run z błędem nie zapisuje kosztu                           |
| A5  | wysoka        | migracja `20260705210509`                           | sekrety jawnie, czytelne dla roli `authenticated`          |
| A6  | wysoka        | `runtime.server.ts:522–1656`                        | jedna funkcja ~1130 linii                                  |
| A7  | średnia       | 12 plików                                           | wywołanie Gemini przepisane ręcznie                        |
| A8  | średnia       | `jarvisBrain.ts:28,327`                             | druga ścieżka czatu w przeglądarce, klucz w `localStorage` |
| A9  | średnia       | `runtime.server.ts:1424`                            | klasyfikator po każdej turze bez narzędzi                  |
| A10 | średnia       | `runtime.functions.ts:875`, `runtime.server.ts:622` | duży kontekst bez cache                                    |
| A11 | średnia       | `runtime.server.ts:1111`                            | tokeny myślenia Gemini nieliczone (do weryfikacji)         |
| A12 | średnia       | `budget.server.ts:27`                               | suma bez paginacji (limit 1000 wierszy)                    |
| A13 | średnia       | `tools.server.ts:255–264`                           | `fetch_url` bez limitu treści i czasu na treść             |
| A14 | średnia→niska | `claude-dev.yml:22`                                 | wyzwalanie słowem `@claude` (repo prywatne)                |
| A15 | średnia       | ~40 miejsc                                          | odpytywanie co 3–8 s                                       |
| A16 | średnia       | `documentJobs.functions.ts:1`                       | zadania w tle odpalane z przeglądarki                      |
| A17 | średnia       | `tools.server.ts`                                   | 33 narzędzia w jednym pliku, mało testów                   |
| A18 | niska         | `runtime.server.ts:1068` i in.                      | klucz Gemini w adresie URL                                 |
| A19 | niska         | `runtime.server.ts:778,1554`                        | status agenta przy równoległych runach                     |
| A20 | niska         | `runtime.server.ts:1209,1543`                       | tokeny Groq po stawce Gemini                               |
| A21 | niska         | `tools.server.ts:1988`                              | linki do plików ważne 7 dni                                |
| A22 | niska         | `ActiveTasksWidget.tsx`, `ui/*`                     | martwy kod                                                 |
| A23 | niska         | `public/`                                           | zdublowany plik wideo                                      |
| A24 | niska         | `package.json`                                      | rozjazdy w zależnościach, dwa lockfile                     |
| A25 | niska         | korzeń repo                                         | brak README, 210 kB notatek roboczych                      |
| A26 | niska         | testy                                               | brak testów przepływów i pomiaru pokrycia                  |
