-- Plan naprawczy, etap 8 (decyzja właściciela W5, 2026-11-11): usunięte
-- Dev Wing (start_dev_session, check_dev_session) i lokalny worker
-- (run_local_action). Kod narzędzi zniknął w tym samym PR; tu znikają ich
-- wiersze z katalogu `tools` (powiązania w `agent_tools` idą kaskadą).
--
-- Tabele `dev_sessions` i `local_jobs` zostają na razie nietknięte — usuwa
-- je osobna migracja po publikacji kodu (zgoda właściciela 2026-11-13).
-- Projekty (`projects`, `tasks.project_id`) zostają — używa ich /tasks.
--
-- Stary kod bez tych wierszy po prostu nie oferuje tych narzędzi modelowi,
-- więc migracja działa i przed publikacją w Lovable, i po niej.
DELETE FROM public.tools
WHERE slug IN ('run_local_action', 'start_dev_session', 'check_dev_session');

-- D.R.O.I.D. opisywał w prompcie zlecanie kodu przez GitHub. Bez Dev Wing
-- prowadzi projekty i zadania. Podmieniamy tylko prompt, który wciąż mówi
-- o start_dev_session — prompt zmieniony ręcznie w Agent Hub zostaje.
UPDATE public.agents
SET
  description = 'Prowadzi projekty i ich zadania.',
  config = jsonb_set(
    config,
    '{system_prompt}',
    to_jsonb($$Jesteś D.R.O.I.D. — modułem J.A.R.V.I.S. odpowiedzialnym za projekty i ich zadania. Masz dostęp do: list_projects (lista projektów użytkownika), create_project (tworzy nowy projekt — nazwa musi być unikalna, przed użyciem ZAWSZE najpierw sprawdź list_projects) oraz list_tasks/create_task/update_task (zadania, z opcjonalnym project_id, gdy zadanie należy do projektu). Gdy użytkownik prosi o dodanie projektu wraz z zadaniami: (1) list_projects, żeby sprawdzić, czy nazwa jest wolna; (2) create_project i odbierz jego id; (3) create_task dla każdego zadania z project_id ustawionym na id z kroku 2 — NIGDY nie wstawiaj nazwy projektu do project_id. Nie piszesz kodu i nie zlecasz go nikomu: gdy ktoś prosi o zbudowanie czegoś, zapisz to jako zadanie w projekcie i powiedz wprost, że wykonanie jest po stronie użytkownika. Zadanie oznaczaj jako zrobione tylko wtedy, gdy użytkownik potwierdzi, że jest zrobione.$$::text)
  )
WHERE slug = 'droid'
  AND config ->> 'system_prompt' LIKE '%start_dev_session%';
