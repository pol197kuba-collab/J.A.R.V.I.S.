-- Plan naprawczy, etap 7 (A15): odświeżanie na żywo zamiast odpytywania co 3–8 s.
-- Klient (src/lib/realtime/liveTables.ts) nasłuchuje zmian tych tabel
-- i unieważnia zapytania, które z nich czytają. agent_runs już jest
-- w publikacji (20260705193213). Realtime przestrzega RLS — każda z tabel ma
-- politykę „owner manages/select”, więc zmiany trafiają tylko do właściciela.
--
-- Idempotentnie: tabela już w publikacji jest pomijana. Stary kod tego nie
-- używa, więc migracja jest bezpieczna przed publikacją w Lovable i po niej.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Brak publikacji supabase_realtime — pomijam.';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['agents', 'agent_runs', 'system_events', 'tasks', 'notes', 'documents', 'generated_files']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
