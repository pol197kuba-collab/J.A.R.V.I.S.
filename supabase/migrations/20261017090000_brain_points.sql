-- =========================================================================
-- MÓZG 3D (PLAN.md, S1.1) — pozycje „gwiazd" wiedzy w przestrzeni 3D.
--
-- Gwiazda = jedno wspomnienie (memories), jedna notatka (notes) albo jeden
-- dokument (documents — reprezentowany średnią embeddingów swoich chunków,
-- żeby 1 plik = 1 gwiazda, a nie setki).
--
-- DWA SPOSOBY UKŁADANIA:
-- 1. Pełny układ (UMAP 768→3D + klastry) liczy nocny job GitHub Actions
--    (scripts/brain-layout.ts) i zapisuje go jednym wywołaniem
--    brain_apply_layout(). Poza bazą, bo UMAP na tysiącach wektorów to
--    sekundy CPU, a serwer aplikacji to Cloudflare Worker z limitem CPU.
-- 2. Nowe elementy w ciągu dnia dokłada brain_place_new() — średnia pozycja
--    5 najbliższych (po embeddingu) już ułożonych gwiazd. Czysty SQL, więc
--    co 10 minut odpala go pg_cron, a strona /mozg woła brain_sync() przy
--    wejściu, żeby świeża notatka była widoczna od razu.
--
-- Notatki dostają przy okazji własną kolumnę embedding (wspomnienia i
-- chunki dokumentów już ją mają).
-- =========================================================================

-- ---------- 1. Embedding notatek ----------
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

-- Zmiana tytułu/treści unieważnia embedding, chyba że ta sama aktualizacja
-- niesie już nowy (tak robią notes.functions.ts i narzędzie save_note).
-- Ścieżki bez embeddingu (MCP, ręczna edycja) dogoni nocny job.
CREATE OR REPLACE FUNCTION public.notes_clear_stale_embedding()
RETURNS trigger
LANGUAGE plpgsql
-- extensions: tam mieszka operator = dla typu vector.
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body)
     AND NEW.embedding IS NOT DISTINCT FROM OLD.embedding THEN
    NEW.embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notes_clear_stale_embedding ON public.notes;
CREATE TRIGGER trg_notes_clear_stale_embedding
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes_clear_stale_embedding();

-- ---------- 2. Tabele ----------
CREATE TABLE IF NOT EXISTS public.brain_points (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('memory', 'note', 'document')),
  source_id UUID NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  cluster_id INTEGER,
  label TEXT NOT NULL,
  -- 1–5: ważność wspomnienia; notatki i dokumenty mają 3.
  weight REAL NOT NULL DEFAULT 3,
  -- 'layout' = z pełnego UMAP, 'neighbors' = dołożona między przebiegami.
  placed_by TEXT NOT NULL DEFAULT 'layout' CHECK (placed_by IN ('layout', 'neighbors')),
  source_created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS public.brain_clusters (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- 'model' = nazwa od modelu, 'keywords' = z najczęstszych słów (bez klucza).
  named_by TEXT NOT NULL DEFAULT 'keywords' CHECK (named_by IN ('model', 'keywords')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  PRIMARY KEY (owner_id, cluster_id)
);

-- Jeden wiersz na użytkownika: kiedy i z czego powstał ostatni pełny układ.
CREATE TABLE IF NOT EXISTS public.brain_layout_runs (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  point_count INTEGER NOT NULL,
  cluster_count INTEGER NOT NULL,
  method TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_points TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_clusters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_layout_runs TO authenticated;
GRANT ALL ON public.brain_points TO service_role;
GRANT ALL ON public.brain_clusters TO service_role;
GRANT ALL ON public.brain_layout_runs TO service_role;

ALTER TABLE public.brain_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_layout_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brain points: owner manages" ON public.brain_points
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Brain clusters: owner manages" ON public.brain_clusters
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Brain layout runs: owner manages" ON public.brain_layout_runs
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- ---------- 3. Źródła gwiazd ----------
-- Wewnętrzna: wszystko z embeddingiem dla jednego właściciela. Nie jest
-- wystawiona użytkownikom (bierze dowolne p_owner) — tylko service_role
-- (nocny job na kluczu serwisowym) i funkcje poniżej.
CREATE OR REPLACE FUNCTION public.brain_source_rows(p_owner uuid)
RETURNS TABLE (
  source_type text,
  source_id uuid,
  label text,
  embedding extensions.vector(768),
  weight real,
  source_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT * FROM (
    SELECT 'memory'::text, m.id, left(coalesce(nullif(btrim(m.key), ''), m.value), 120),
           m.embedding, m.importance::real, m.created_at
    FROM public.memories m
    WHERE m.user_id = p_owner AND m.embedding IS NOT NULL
    UNION ALL
    SELECT 'note'::text, n.id, left(n.title, 120), n.embedding, 3::real, n.created_at
    FROM public.notes n
    WHERE n.owner_id = p_owner AND n.embedding IS NOT NULL
    UNION ALL
    SELECT 'document'::text, d.id, left(d.filename, 120), avg(c.embedding), 3::real, d.created_at
    FROM public.documents d
    JOIN public.document_chunks c ON c.document_id = d.id
    WHERE d.user_id = p_owner AND c.embedding IS NOT NULL
    GROUP BY d.id
  ) s (source_type, source_id, label, embedding, weight, source_created_at)
  ORDER BY s.source_type, s.source_id
$$;

REVOKE ALL ON FUNCTION public.brain_source_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_source_rows(uuid) TO service_role;

-- To samo dla zalogowanego użytkownika — wyłącznie jego własne dane.
CREATE OR REPLACE FUNCTION public.brain_sources()
RETURNS TABLE (
  source_type text,
  source_id uuid,
  label text,
  embedding extensions.vector(768),
  weight real,
  source_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT * FROM public.brain_source_rows(auth.uid()) WHERE auth.uid() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.brain_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_sources() TO authenticated, service_role;

-- ---------- 4. Zapis pełnego układu (jedna transakcja) ----------
-- p_points: [{source_type, source_id, x, y, z, cluster_id, label, weight,
--             source_created_at}], p_clusters: [{cluster_id, name, named_by,
-- x, y, z}]. Zastępuje cały układ właściciela naraz, więc strona nigdy nie
-- zobaczy połowy starego i połowy nowego. SECURITY INVOKER: zalogowany
-- użytkownik pisze przez RLS tylko u siebie, service_role omija RLS.
CREATE OR REPLACE FUNCTION public.brain_apply_layout(
  p_owner uuid,
  p_points jsonb,
  p_clusters jsonb,
  p_method text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  inserted integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_owner THEN
    RAISE EXCEPTION 'brain_apply_layout: cudzy układ' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.brain_points WHERE owner_id = p_owner;
  DELETE FROM public.brain_clusters WHERE owner_id = p_owner;

  INSERT INTO public.brain_clusters (owner_id, cluster_id, name, named_by, x, y, z)
  SELECT p_owner, c.cluster_id, c.name, c.named_by, c.x, c.y, c.z
  FROM jsonb_to_recordset(p_clusters)
    AS c (cluster_id integer, name text, named_by text, x real, y real, z real);

  INSERT INTO public.brain_points
    (owner_id, source_type, source_id, x, y, z, cluster_id, label, weight, placed_by, source_created_at)
  SELECT p_owner, p.source_type, p.source_id, p.x, p.y, p.z, p.cluster_id, p.label,
         coalesce(p.weight, 3), 'layout', p.source_created_at
  FROM jsonb_to_recordset(p_points)
    AS p (source_type text, source_id uuid, x real, y real, z real, cluster_id integer,
          label text, weight real, source_created_at timestamptz);
  GET DIAGNOSTICS inserted = ROW_COUNT;

  INSERT INTO public.brain_layout_runs (owner_id, computed_at, point_count, cluster_count, method, meta)
  VALUES (p_owner, now(), inserted, jsonb_array_length(p_clusters), p_method, p_meta)
  ON CONFLICT (owner_id) DO UPDATE
    SET computed_at = EXCLUDED.computed_at,
        point_count = EXCLUDED.point_count,
        cluster_count = EXCLUDED.cluster_count,
        method = EXCLUDED.method,
        meta = EXCLUDED.meta;

  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.brain_apply_layout(uuid, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_apply_layout(uuid, jsonb, jsonb, text, jsonb)
  TO authenticated, service_role;

-- ---------- 5. Dokładanie nowych gwiazd między przebiegami ----------
-- Zwraca liczbę dołożonych. Przy okazji: usuwa gwiazdy, których źródło
-- zniknęło, i odświeża podpisy (np. zmieniony tytuł notatki). Do pierwszego
-- pełnego układu nie robi nic — nie ma się do czego zakotwiczyć.
CREATE OR REPLACE FUNCTION public.brain_place_new(p_owner uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  placed integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brain_points WHERE owner_id = p_owner) THEN
    RETURN 0;
  END IF;

  -- Sprawdzane po tabelach źródłowych, nie po embeddingu: notatka w trakcie
  -- edycji (embedding chwilowo NULL) zostaje na swoim miejscu.
  DELETE FROM public.brain_points p
  WHERE p.owner_id = p_owner
    AND NOT (
      (p.source_type = 'memory' AND EXISTS (SELECT 1 FROM public.memories m WHERE m.id = p.source_id))
      OR (p.source_type = 'note' AND EXISTS (SELECT 1 FROM public.notes n WHERE n.id = p.source_id))
      OR (p.source_type = 'document' AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = p.source_id))
    );

  CREATE TEMP TABLE IF NOT EXISTS brain_src ON COMMIT DROP AS
    SELECT * FROM public.brain_source_rows(p_owner) WITH NO DATA;
  TRUNCATE brain_src;
  INSERT INTO brain_src SELECT * FROM public.brain_source_rows(p_owner);

  -- Podpisy i wagi prosto z tabel źródłowych (nie z brain_src): zmieniony
  -- tytuł notatki ma być widoczny, zanim nocny job odświeży jej embedding.
  UPDATE public.brain_points p
  SET label = left(coalesce(nullif(btrim(m.key), ''), m.value), 120),
      weight = m.importance, updated_at = now()
  FROM public.memories m
  WHERE p.owner_id = p_owner AND p.source_type = 'memory' AND m.id = p.source_id
    AND (p.label IS DISTINCT FROM left(coalesce(nullif(btrim(m.key), ''), m.value), 120)
         OR p.weight IS DISTINCT FROM m.importance::real);
  UPDATE public.brain_points p
  SET label = left(n.title, 120), updated_at = now()
  FROM public.notes n
  WHERE p.owner_id = p_owner AND p.source_type = 'note' AND n.id = p.source_id
    AND p.label IS DISTINCT FROM left(n.title, 120);
  UPDATE public.brain_points p
  SET label = left(d.filename, 120), updated_at = now()
  FROM public.documents d
  WHERE p.owner_id = p_owner AND p.source_type = 'document' AND d.id = p.source_id
    AND p.label IS DISTINCT FROM left(d.filename, 120);

  WITH anchored AS MATERIALIZED (
    SELECT s.embedding, p.x, p.y, p.z, p.cluster_id
    FROM brain_src s
    JOIN public.brain_points p
      ON p.owner_id = p_owner AND p.source_type = s.source_type AND p.source_id = s.source_id
  ),
  fresh AS (
    SELECT s.*
    FROM brain_src s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.brain_points p
      WHERE p.owner_id = p_owner AND p.source_type = s.source_type AND p.source_id = s.source_id
    )
    LIMIT 500
  )
  INSERT INTO public.brain_points
    (owner_id, source_type, source_id, x, y, z, cluster_id, label, weight, placed_by, source_created_at)
  SELECT
    p_owner, f.source_type, f.source_id,
    -- Mały, stały (z id) rozrzut, żeby dwie gwiazdy z tymi samymi
    -- sąsiadami nie wylądowały w jednym punkcie.
    nb.ax + (hashtext(f.source_id::text || 'x') % 1000) / 40000.0,
    nb.ay + (hashtext(f.source_id::text || 'y') % 1000) / 40000.0,
    nb.az + (hashtext(f.source_id::text || 'z') % 1000) / 40000.0,
    nb.cl, f.label, f.weight, 'neighbors', f.source_created_at
  FROM fresh f
  CROSS JOIN LATERAL (
    SELECT avg(k.x) AS ax, avg(k.y) AS ay, avg(k.z) AS az,
           mode() WITHIN GROUP (ORDER BY k.cluster_id) AS cl
    FROM (
      SELECT a.x, a.y, a.z, a.cluster_id
      FROM anchored a
      ORDER BY a.embedding <=> f.embedding
      LIMIT 5
    ) k
  ) nb
  WHERE nb.ax IS NOT NULL;
  GET DIAGNOSTICS placed = ROW_COUNT;

  RETURN placed;
END;
$$;

REVOKE ALL ON FUNCTION public.brain_place_new(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brain_place_new(uuid) TO service_role;

-- Dla strony /mozg: dołóż MOJE nowe gwiazdy teraz, nie czekając na pg_cron.
CREATE OR REPLACE FUNCTION public.brain_sync()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.brain_place_new(auth.uid()) END
$$;

REVOKE ALL ON FUNCTION public.brain_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_sync() TO authenticated;

-- Dla pg_cron: wszyscy, którzy mają już pełny układ.
CREATE OR REPLACE FUNCTION public.brain_sync_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o uuid;
  total integer := 0;
BEGIN
  FOR o IN SELECT owner_id FROM public.brain_layout_runs LOOP
    total := total + public.brain_place_new(o);
  END LOOP;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.brain_sync_all() FROM PUBLIC, anon, authenticated;

-- ---------- 6. Harmonogram ----------
-- Zadanie o tej samej nazwie jest nadpisywane, więc ponowne wgranie
-- migracji nie zdubluje harmonogramu.
SELECT cron.schedule('brain-sync', '*/10 * * * *', $cron$SELECT public.brain_sync_all()$cron$);
