# J.A.R.V.I.S.

Osobisty asystent AI w formie webowego HUD-a: czat i głos z J.A.R.V.I.S.-em,
który deleguje pracę do zespołu agentów (H.E.R.A.L.D., I.N.S.I.G.H.T.,
M.E.T.R.I.C., S.H.I.E.L.D., F.O.R.G.E.), plus moduły wokół tego — notatki,
zadania, dokumenty, rynki, paliwa, dojazd do pracy, Mózg 3D, Agent Town.

- **Front i serwer:** React 19 + TanStack Start (funkcje serwerowe), Tailwind 4,
  three.js / R3F dla scen 3D. Hosting: **Lovable** (gałąź `main` jest
  zsynchronizowana z Lovable — bez przepisywania historii, patrz `AGENTS.md`).
- **Dane:** Supabase (Postgres + RLS, Auth, Storage, Realtime, pg_cron, pg_net).
- **Modele:** Gemini (obowiązkowy klucz), opcjonalnie Claude (Anthropic) i Groq.
- **Zadania w tle:** GitHub Actions uruchamiane przez bazę (pg_cron → `workflow_dispatch`).

Zasady projektu (kolory z tokenów, `no-scrollbar`, container queries, kontrakt
wierności 3D, HUD/Town) są w **`CLAUDE.md`**. Plan spłaty długu technicznego:
`docs/naprawa/PLAN_NAPRAWCZY.md`.

## Uruchomienie lokalne

Wymagany Node 22 (jak w CI).

```bash
npm ci
npm run dev          # serwer deweloperski Vite / TanStack Start
npm run typecheck    # tsc --noEmit
npm test             # vitest run (testy w src/**/*.test.ts)
npm run lint         # eslint + prettier
```

`npm ci` (nie `bun install`) — `package-lock.json` jest lockfile'em, który
sprawdza CI. `bun.lock` jest drugim lockfile'em (Lovable); przy zmianie
zależności oba muszą zostać spójne, a `bunfig.toml` blokuje wersje młodsze niż
24 h.

Aplikacja łączy się z produkcyjnym projektem Supabase wpisanym w
`vite.config.ts` (adres i klucz publiczny). Inny projekt: ustaw
`JARVIS_SUPABASE_URL` i `JARVIS_SUPABASE_PUBLISHABLE_KEY` przed `npm run dev`.
Funkcje serwerowe, które potrzebują klucza service role, czytają
`JARVIS_SUPABASE_SERVICE_ROLE_KEY` (zapas: `SUPABASE_SERVICE_ROLE_KEY`).

## Sekrety

### Hosting (Lovable → sekrety projektu)

| Nazwa                              | Po co                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JARVIS_SUPABASE_URL`              | adres projektu Supabase po stronie serwera (Lovable wstrzykuje własne `SUPABASE_*` wskazujące na starą, wbudowaną bazę — te ignorujemy, patrz `src/integrations/supabase/env.ts`) |
| `JARVIS_SUPABASE_SERVICE_ROLE_KEY` | klucz service role dla funkcji serwerowych (m.in. moduł paliw); omija RLS, nigdy nie trafia do przeglądarki                                                                       |
| `JARVIS_SUPABASE_PUBLISHABLE_KEY`  | opcjonalnie, nadpisuje klucz publiczny z `vite.config.ts`                                                                                                                         |

### GitHub Actions (repo → Settings → Secrets and variables → Actions)

Jedna droga uwierzytelnienia jobów: klucz service role + właściciel
(`src/lib/jobs/jobRun.ts`, etap 6b). Od etapu 5 klucze z `user_secrets` czyta
tylko service role, więc logowania e-mailem i hasłem nie ma — bez wymaganych
sekretów job kończy się na czerwono (`::error::`), a nie po cichu bez pracy.

**Wymagane** — bez nich nie działa żaden job danych:

| Nazwa                       | Co przestaje działać bez niego                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | wszystkie joby danych (czerwone od pierwszej linii)                                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | wszystkie joby danych; to też jedyna droga do kluczy z `user_secrets` (TomTom, VAPID dla pushy, Gemini dla Mózgu 3D) |
| `JARVIS_OWNER_ID`           | wszystkie joby danych — wskazuje, czyje dane (watchlista, briefing, dojazd, dokumenty) job obsługuje                 |
| `SUPABASE_DB_URL`           | DB Migrations — migracje nie wchodzą do bazy po merge                                                                |

**Opcjonalne** — job działa bez nich, z opisaną degradacją (`::warning::`):

| Nazwa               | Używają                                      | Bez niego                                                                                                   |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`    | Morning Brief, Market Grid/Live, Orlen, Mózg | briefing z samych liczb, newsy z oceną heurystyczną, prognoza tylko sygnałowa; Mózg bierze klucz z Ustawień |
| `ANTHROPIC_API_KEY` | Morning Brief, Market Grid/Live              | jak wyżej (gdy brak też Gemini)                                                                             |
| `TOMTOM_API_KEY`    | Commute Watch                                | zapas — pierwszeństwo ma klucz z Ustawień; bez obu job jest **czerwony** (alert o korku nie może działać)   |

`JARVIS_EMAIL`, `JARVIS_PASSWORD` i `SUPABASE_PUBLISHABLE_KEY` nie są już
czytane przez żaden workflow (lokalny worker ma własny `.env`).

### Klucze użytkownika (tabela `user_secrets`, Ustawienia → Klucze API)

`gemini_api_key` (wymagany przez runtime agentów), `anthropic_api_key`,
`groq_api_key`, `google_cse_api_key` + `google_cse_cx`, `tomtom_api_key`,
`github_token` (fine-grained PAT tylko dla tego repo: Actions + Issues —
z niego baza uruchamia workflowy), `vapid_public_key` / `vapid_private_key` /
`vapid_subject` (powiadomienia push).

## Workflowy GitHub Actions

| Workflow            | Co robi                                                                | Kto uruchamia                                                      |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ci.yml`            | lint, typecheck, testy                                                 | push i PR do `main`                                                |
| `db-migrations.yml` | migracje z `supabase/migrations` do bazy (`scripts/db-migrations.sh`)  | PR → `check`; merge do `main` → `push`; ręcznie                    |
| `morning-brief.yml` | poranna rubryka + push (`scripts/morning-brief.ts`)                    | pg_cron `morning-brief-dispatch`; zapasowy cron GitHuba co godzinę |
| `market-grid.yml`   | notowania, newsy, prognozy /rynki (`scripts/markets-daily.ts`)         | pg_cron `market-grid-dispatch`; zapasowe crony GitHuba             |
| `market-live.yml`   | realizacje prognoz i stopy w trakcie sesji (`scripts/markets-live.ts`) | pg_cron `market-live-dispatch` (co 15 min)                         |
| `commute-watch.yml` | alert o korku na trasie dom ↔ praca (`scripts/commute-watch.ts`)       | pg_cron `commute-watch-dispatch`; zapasowy cron w dni robocze      |
| `orlen-prices.yml`  | cennik hurtowy Orlenu, Brent, USD/PLN (`scripts/orlen-daily.ts`)       | cron GitHuba (pn–pt 07:30 i 15:30 CEST)                            |
| `brain-layout.yml`  | pełny układ Mózgu 3D (`scripts/brain-layout.ts`)                       | cron GitHuba (03:40 CEST)                                          |
| `document-jobs.yml` | dokończenie dokumentów i grafik w tle (`scripts/document-jobs.ts`)     | pg_cron `document-jobs-dispatch`, tylko gdy coś czeka              |

## Zadania pg_cron (w bazie)

| Zadanie                  | Harmonogram          | Co robi                                                                                                 | Migracja                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `morning-brief-dispatch` | co 5 min             | gdy wybiła godzina briefingu, prosi GitHuba o `morning-brief.yml` (token z `user_secrets.github_token`) | `20261020090000_brief_dispatch.sql`         |
| `market-grid-dispatch`   | co 5 min             | uruchamia `market-grid.yml` o czasie                                                                    | `20261020120000_market_grid_dispatch.sql`   |
| `market-live-dispatch`   | co 15 min            | uruchamia `market-live.yml`                                                                             | `20261102090000_market_live.sql`            |
| `commute-watch-dispatch` | co 5 min             | uruchamia `commute-watch.yml` w oknie wyjazdu i powrotu                                                 | `20261110091000_commute_watch_dispatch.sql` |
| `document-jobs-dispatch` | co minutę            | uruchamia `document-jobs.yml`, gdy zadanie lub grafiki czekają (najwyżej raz na 5 min, 40 na dobę)      | `20261112170000_document_jobs_dispatch.sql` |
| `brain-sync`             | co 10 min            | `brain_sync_all()` — nowe gwiazdy Mózgu 3D                                                              | `20261017090000_brain_points.sql`           |
| `brain-traces-cleanup`   | codziennie 03:20 UTC | kasuje ślady Mózgu starsze niż 30 dni                                                                   | `20261017120000_brain_traces.sql`           |

Migracje wchodzą do bazy same po merge do `main`, niezależnie od wdrożenia
aplikacji — każda musi działać ze starym i z nowym kodem.

## Gdzie co jest

- `src/lib/agents/` — runtime agentów (`runtime.server.ts`), narzędzia
  (`tools.server.ts`), dostawcy modeli (`providers/`), cennik i budżet.
- `src/routes/` — moduły (trasy TanStack Router).
- `src/components/` — UI: `jarvis/` (HUD i moduły), `town/` (Agent Town), `brain/` (Mózg 3D), `ui/` (shadcn).
- `supabase/migrations/` — schemat bazy; `scripts/` — joby GitHub Actions.
- `docs/` — prototypy scen 3D, plan naprawczy.
