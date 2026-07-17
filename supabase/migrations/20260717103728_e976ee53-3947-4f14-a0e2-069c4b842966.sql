
CREATE OR REPLACE FUNCTION public.get_public_schema_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tables jsonb;
  v_policies jsonb;
  v_foreign_keys jsonb;
  v_enums jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(t ORDER BY t->>'name') INTO v_tables
  FROM (
    SELECT jsonb_build_object(
      'name', c.relname,
      'rls_enabled', c.relrowsecurity,
      'columns', (
        SELECT jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'nullable', NOT a.attnotnull,
          'default', pg_get_expr(ad.adbin, ad.adrelid),
          'is_primary_key', COALESCE(pk.is_pk, false),
          'position', a.attnum
        ) ORDER BY a.attnum)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        LEFT JOIN (
          SELECT conrelid, unnest(conkey) AS attnum, true AS is_pk
          FROM pg_constraint WHERE contype = 'p'
        ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      )
    ) AS t
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ) sub;

  SELECT jsonb_agg(jsonb_build_object(
    'table', cl.relname,
    'column', att.attname,
    'ref_table', fcl.relname,
    'ref_column', fatt.attname,
    'constraint', con.conname
  )) INTO v_foreign_keys
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class fcl ON fcl.oid = con.confrelid
  JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
  JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = ck.attnum
  JOIN pg_attribute fatt ON fatt.attrelid = fcl.oid AND fatt.attnum = fk.attnum
  WHERE con.contype = 'f' AND n.nspname = 'public';

  SELECT jsonb_agg(jsonb_build_object(
    'table', tablename,
    'name', policyname,
    'command', cmd,
    'roles', roles,
    'permissive', permissive,
    'using', qual,
    'with_check', with_check
  )) INTO v_policies
  FROM pg_policies WHERE schemaname = 'public';

  SELECT jsonb_agg(jsonb_build_object(
    'name', t.typname,
    'values', (
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = t.oid
    )
  )) INTO v_enums
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e';

  RETURN jsonb_build_object(
    'tables', COALESCE(v_tables, '[]'::jsonb),
    'foreign_keys', COALESCE(v_foreign_keys, '[]'::jsonb),
    'policies', COALESCE(v_policies, '[]'::jsonb),
    'enums', COALESCE(v_enums, '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_schema_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_schema_snapshot() TO authenticated;
