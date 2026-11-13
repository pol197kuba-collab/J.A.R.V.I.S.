# TODO — otwarte

> Tylko to, co otwarte. Zrobione wpisy (historia od 2026-07) są w
> [`docs/archiwum/TODO.md`](docs/archiwum/TODO.md); bieżące prace naprawcze
> w [`docs/naprawa/PLAN_NAPRAWCZY.md`](docs/naprawa/PLAN_NAPRAWCZY.md).
> Przeniesione bez zmian 2026-11-13 (plan naprawczy, etap 8) — część wpisów
> właściciela może być już nieaktualna (np. migracje wchodzą same od 2026-10-16).

## 0. Po stronie właściciela (nie do zrobienia z repo)

- [ ] **Rynki — fundusz z dźwignią i granie na żywo (PR #188, #189, 2026-11-01).**
      Wkleić w edytorze SQL, w tej kolejności:
      `20261101210000_market_model_usage.sql` (budżet tokenów — bez tej
      tabeli model nie jest wołany wcale) i `20261102090000_market_live.sql`
      (zdarzenia na żywo + pg_cron co 15 min → `market-live.yml`). Potem
      Lovable → Publish → Update, żeby nowy UI /rynki trafił na produkcję.
      Sprawdzenie: Actions → Market Live ma przebiegi co ~15 min, a panel
      Fundusz pokazuje zieloną kropkę „Na żywo”.

- [ ] **`GEMINI_API_KEY` jako sekret w GitHubie** (Settings → Secrets and
      variables → Actions). Bez niego nocne joby działają, ale newsy
      dostają ocenę słownikową zamiast modelu, a typer zapisuje wyłącznie
      prognozę sygnałową. Widać to w logu przebiegu jako
      `0 ocenionych przez model` i `interpretacja: same sygnały`.
      Cztery pozostałe sekrety (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
      `JARVIS_EMAIL`, `JARVIS_PASSWORD`) są już ustawione i zweryfikowane
      udanym przebiegiem 2026-09-21 05:47 UTC.

- [ ] **Doładowanie konta Anthropic.** Klucz jest zapisany i w aplikacji, i
      w sekretach, ale konto nie ma środków — płatność odrzucana przez
      operatora (Google Pay). Anthropic zwykle odrzuca portfele oraz karty
      prepaid i wirtualne; skuteczna bywa zwykła karta kredytowa dodana
      wprost w Billing. Nic nie jest tym zablokowane: runtime schodzi na
      Gemini, a Claude włączy się sam, gdy kredyty się pojawią — bez
      żadnej zmiany konfiguracji.

- [ ] **Opcjonalnie: ETF WIG20TR zamiast WIG20 na watchliście.** Yahoo
      serwuje dla samego indeksu tylko ostatnie notowanie, a Stooq jest
      blokowany z IP hostingu, więc wykres WIG20 zostaje jednym punktem.
      ETF ma pełną historię w obu źródłach (szczegóły w `assets.ts`).

- [ ] **Wgrać trzy migracje stałych rozkazów w edytorze SQL Lovable**
      (kolejno: `20260922100000_standing_orders.sql`,
      `20260922110000_standing_order_agent_tools.sql`,
      `20260922120000_push_subscriptions.sql`). Bez pierwszej panel
      „ROZKAZY // PROGI" w /rynki i /paliwa nie ma gdzie zapisywać, bez
      drugiej J.A.R.V.I.S. nie zobaczy narzędzi (runtime pyta bazę, nie
      kod), bez trzeciej nie ma gdzie trzymać subskrypcji urządzeń.
      Pierwsza przenosi przy okazji istniejące progi paliwowe — stara
      tabela `fuel_price_alerts` zostaje nietknięta.

- [ ] **Włączyć powiadomienia na telefonie** (Ustawienia → POWIADOMIENIA //
      URZĄDZENIA, przycisk „włącz na tym urządzeniu"). Zgoda jest wydawana
      osobno w każdej przeglądarce, więc laptop i telefon trzeba włączyć
      oddzielnie. Na iPhonie Web Push działa WYŁĄCZNIE po dodaniu
      aplikacji do ekranu początkowego — samo Safari nie wystarczy.
      Klucze VAPID generują się same przy pierwszym włączeniu.

- [ ] **Wgrać dwie migracje porannego briefingu** (`20260923090000_daily_briefs.sql`,
      `20260923100000_daily_brief_agent_tool.sql`). Bez pierwszej nocny job
      nie ma gdzie zapisać rubryki, bez drugiej J.A.R.V.I.S. nie odczyta jej
      na pytanie „streść mi dzień" — runtime pyta bazę, nie kod.

- [ ] **Wgrać dwie migracje** (`20260923110000_brief_schedule.sql` — godzina
      briefingu i tryb cichy; `20260923120000_document_jobs_attempts.sql` —
      licznik podejść zadań dokumentowych). Druga przy okazji zamyka wpisy
      zaklinowane w `running` sprzed wdrożenia ponowień.

- [ ] **Wgrać migrację licznika kosztów** (`20260923130000_token_budget.sql`).
      Bez niej panel BUDŻET nie ma skąd czytać, a degradacja przy limicie się
      nie włączy. Limit startowy to $5/miesiąc — do zmiany w Ustawieniach.

- [x] **Migracje same do bazy (Etap 0, `db-migrations.yml`)** — zrobione
      2026-10-16: sekret, baseline `20261016180000` i push zielone. — dwa kroki,
      jednorazowo: 1. **Sekret `SUPABASE_DB_URL`** w GitHubie (Settings → Secrets and
      variables → Actions): panel Supabase → **Connect** → **Session
      pooler** → skopiuj URI i wstaw hasło bazy (znaki specjalne w haśle
      zakodowane procentowo, np. `@` → `%40`). Pooler, nie adres
      `db.<ref>.supabase.co` — ten działa tylko po IPv6. 2. **Baseline**: Actions → **DB Migrations** → Run workflow →
      `mode: baseline`, `up_to:` ostatnia migracja, która JUŻ jest w bazie.
      Jeśli nowa baza ma komplet (w SQL editorze zwraca `true`:
      `select exists(select 1 from information_schema.columns where
       table_name='market_predictions' and column_name='lessons')`), to
      `up_to = 20261016180000`. Potem Run workflow z `mode: push` wgrywa
      `20261016200000_pg_cron_pg_net.sql`; od tej pory każdy merge do
      `main` robi to sam. Bez baseline `push` celowo odmawia — inaczej
      próbowałby zbudować bazę od zera na istniejących tabelach.

- [ ] **Garage Radar w tej bazie: wystawić schemat `garage_radar`** (po
      merge migracji `20261027120000_garage_radar.sql`). Supabase →
      Integrations → Data API → Settings → _Exposed schemas_ → zaznaczyć
      `garage_radar` → Save. Bez tego aplikacja Garage Radar (osobne repo,
      Vercel) nie widzi swoich tabel. Schemat `public` J.A.R.V.I.S.-a nie
      jest przez tę migrację zmieniany.

## 8. [F] Concierge agent (calendar / email) — new agent proposal

Cheap to add: prompt-only persona like Marketer, no new architecture,
bound to the calendar/email OAuth tools below once they exist. Natural
pairing rather than a standalone "tools" item with no agent to use them.

## 9. [F] Calendar / email tools

OAuth-backed tools via the existing tool-registry pattern
(`public.tools` + per-agent binding) — same shape as `web_search`/
`fetch_url`, no new architecture. Ships together with Concierge (#8).

## 10. [F] Cleanup backlog (low priority, batch together)

- `user_settings.default_model` is dead — nothing reads it (`agents.model`
  always wins). Wire it up as a real fallback once multi-provider routing
  lands, or delete it.

## Long-shot / not scheduled

- **Local device bridge** (desktop automation, local Ollama) — needs a new
  architectural piece (a local companion process talking to
  `device_commands`) before either feature is attemptable at all. Don't
  start this without deciding on the bridge first — see `CODEX.md`
  Architecture constraints.

- **Developer agent — dispatch to a Claude Code Routine** (discussed
  2026-07-20). Explicitly _after_ Producer, not before — noted here so the
  idea isn't lost, not queued as a numbered item yet.

  Real mechanism, not speculative: Claude Code Routines support an **API
  trigger** — `POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire`
  with a bearer token — which starts a full, isolated Claude Code cloud
  session (real shell, real repo creation/push, real test execution) and
  returns `{session_id, session_url}` immediately. This is the realistic
  path for "write me a new app, test it, fix bugs" — JARVIS itself never
  gets code/filesystem access (keeps the rule already established for
  Guardian and every other in-app agent intact), it only dispatches to a
  fully separate Anthropic-managed sandbox.

  Shape, if/when picked up: one new tool (`dispatch_build_task` or
  similar) — a single authenticated `fetch`, same complexity class as the
  existing `flightRadar.functions.ts` server function. Bearer token stored
  via the same BYOK pattern as the Groq key (`user_secrets`). Requires a
  **one-time manual setup outside this codebase**: create the Routine
  itself at `claude.ai/code/routines` with a self-contained prompt (can't
  be authored dynamically by JARVIS), add its API trigger, generate the
  token. JARVIS's tool call only ever supplies the `text` field — the
  actual task spec — per dispatch.

  Real constraints to design around, not glossed over:
  - **Experimental/beta** (`experimental-cc-routine-2026-04-01` header) —
    request/response shape and limits may change.
  - **Draws down the user's own Claude subscription usage** (daily
    routine-run cap), not a separate free/metered API budget like Groq —
    a real cost consideration, not "free infrastructure."
  - **Fire-and-forget, not synchronous** — the `/fire` call returns a
    session URL immediately; there's no confirmed API to poll/read the
    finished result back into JARVIS's own chat. First version means
    JARVIS hands back a link and the user opens/reviews/tests it
    themselves — "JARVIS watches it finish and reports back" is not
    currently buildable without a further, unconfirmed capability.

## Agent Town — propozycje kolejnych poleceń i interakcji (do wyboru)

1. **Przeciągnij kartkę do pokoju** — zadanie upuszczone na pokój agenta
   trafia prosto do niego (dziś: wybór z listy „Dla:”).
2. **Rozmowa z agentem na mapie** — klik w postać otwiera okienko
   dialogowe RPG z historią rozmowy z tym agentem i polem odpowiedzi.
3. **Zatrzymaj / ponów zadanie** — przyciski w panelu agenta: przerwij
   bieżący przebieg, ponów ostatni z błędem (wymaga endpointu do
   anulowania przebiegu).
4. **Priorytet i termin na kartce** — kolor pinezki = pilność, termin
   widoczny na tablicy; spięte z modułem Tasks.
5. **Zadania cykliczne jako „dyżury”** — standing orders widoczne jako
   grafik na ścianie Rdzenia; agent sam wstaje o danej porze.
6. **Spotkanie przy stole** — polecenie „naradźcie się” zbiera kilku
   agentów przy stole w Rdzeniu; każdy dokłada swoją część, J.A.R.V.I.S.
   składa wynik.
7. **Głos na mapie** — komenda głosowa z HeaderVoiceToggle widoczna jako
   dymek Twojej postaci (dziś trafia tylko do czatu).
8. **Powiadomienie, gdy wynik czeka** — Twoja postać dostaje „!” nad
   głową, a dzwonek pokazuje, który agent coś przyniósł.
9. **Skróty klawiszowe** — 1–6 zaznacza agenta, Enter otwiera polecenie,
   F śledzi kamerą zaznaczonego agenta.
10. **Ulepszenia pokojów jako statystyki** — np. więcej regałów w
    Archiwum = więcej dokumentów w RAG; lekka grywalizacja postępu.
