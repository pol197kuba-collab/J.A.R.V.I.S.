# local-worker

Etap 05 z planu architektury: most między istniejącym Agent Runtime
(TanStack Start + Supabase, `src/lib/agents/`) a Twoim komputerem. Jedyny
proces w całym systemie, który dotyka realnego dysku — reszta (orkiestrator,
pamięć, generowanie dokumentów) już działa w chmurze i zmian nie wymaga.

## Jak to działa

1. `run_local_action` (nowe narzędzie w `tools.server.ts`) wstawia wiersz do
   `public.local_jobs` w Supabase i czeka do 20s na wynik.
2. `worker.py`, uruchomiony tutaj, na Twoim komputerze, loguje się do tego
   samego Supabase jako Ty (nie service role) i co 2 sekundy odpytuje własne
   `pending` zadania.
3. Wykonuje akcję lokalnie (w obrębie `JARVIS_WORKDIR`, nic poza nim) i
   zapisuje wynik z powrotem — `run_local_action` go odbiera i zwraca modelowi.

Zero nowej infrastruktury (Redis itp.) — kolejką jest zwykła, chroniona przez
RLS tabela w bazie, której już używacie.

## Uruchomienie

```bash
cd local-worker
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# uzupełnij .env: SUPABASE_URL, SUPABASE_ANON_KEY, JARVIS_EMAIL, JARVIS_PASSWORD
python worker.py
```

Worker musi być uruchomiony, żeby `run_local_action` działało — jeśli nie
odbierze zadania w 20s, JARVIS dostanie `worker_offline` i powie Ci o tym
głosem zamiast zawiesić się w ciszy.

## Dostępne akcje (Etap 04/05 z planu)

- `list_dir` — lista plików w katalogu
- `read_text_file` — odczyt pliku tekstowego (limit 200 000 znaków)
- `write_text_file` — zapis/nadpisanie pliku tekstowego

Wszystkie ścieżki są względne wobec `JARVIS_WORKDIR` (domyślnie `~/Jarvis`) —
próba wyjścia poza ten katalog (`../../etc/passwd` itp.) jest odrzucana w
`resolve_path()`. Terminal/powłoka i sterowanie przeglądarką (Playwright) z
planu architektury celowo NIE są tu jeszcze zaimplementowane — to
najbardziej ryzykowne akcje (dowolne wykonanie kodu), które zasługują na
osobną, bardziej przemyślaną warstwę uprawnień, a nie doklejenie do MVP.

## Dlaczego klucz anon + logowanie, a nie service role

Service role omija RLS całkowicie — wyciek takiego klucza z laptopa daje
pełny dostęp do całej bazy. Worker loguje się jak zwykły użytkownik, więc
Row Level Security na `local_jobs` (patrz migracja
`20260814120000_local_worker_jobs.sql`) ogranicza go dokładnie tak samo jak
przeglądarkę — widzi wyłącznie własne zadania.
