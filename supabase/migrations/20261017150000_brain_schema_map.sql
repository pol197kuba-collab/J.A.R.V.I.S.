-- =========================================================================
-- MÓZG 3D (PLAN.md, S1.4) — tryb STRUKTURA: mapa tabel bazy.
--
-- brain_schema_map(): tabele schematu public z kolumnami, szacowaną liczbą
-- wierszy (pg_class.reltuples — bez skanowania tabel), nazwami polityk RLS
-- i kluczami obcymi. Lżejsza siostra get_public_schema_snapshot (/schema):
-- bez treści polityk i bez wymogu roli admin — struktura bazy to i tak
-- kod z publicznego repo, a strona /mozg ma działać dla właściciela bez
-- osobnego nadawania ról. DANE z tabel nie przechodzą tędy wcale — podgląd
-- wierszy idzie zwykłym zapytaniem przez RLS (src/lib/brain/structure.functions.ts).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.brain_schema_map()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'rls', c.relrowsecurity,
        -- -1 = tabela jeszcze nie analizowana; dla mapy to „nie wiadomo”.
        'rows_estimate', GREATEST(c.reltuples, -1)::bigint,
        'columns', (
          SELECT jsonb_agg(jsonb_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'nullable', NOT a.attnotnull,
            'pk', EXISTS (
              SELECT 1 FROM pg_constraint pk
              WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY (pk.conkey)
            )
          ) ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ),
        'policies', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', p.policyname, 'command', p.cmd)
                           ORDER BY p.policyname)
          FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
        ), '[]'::jsonb)
      ) ORDER BY c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ), '[]'::jsonb),
    'foreign_keys', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table', cl.relname,
        'column', att.attname,
        'ref_table', fcl.relname,
        'ref_column', fatt.attname
      ))
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
      JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
      JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
      JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = ck.attnum
      JOIN pg_attribute fatt ON fatt.attrelid = fcl.oid AND fatt.attnum = fk.attnum
      -- Tylko powiązania wewnątrz public (auth.users nie jest planetą na mapie).
      WHERE con.contype = 'f' AND n.nspname = 'public' AND fn.nspname = 'public'
    ), '[]'::jsonb),
    'generated_at', now()
  )
  WHERE auth.uid() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.brain_schema_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_schema_map() TO authenticated;
