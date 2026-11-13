-- Modele agentów po wycofaniu Gemini 2.5 (zgłoszenie i decyzja właściciela
-- 2026-11-13). Strony aistudio.google.com/docs/deprecations i /docs/models
-- (sprawdzone 2026-11-13): gemini-2.5-flash i gemini-2.5-pro wycofane
-- 2026-11-02, wyłączenie 2026-12-01.
--
-- Podział „mieszany” wybrany przez właściciela:
--   J.A.R.V.I.S., F.O.R.G.E., H.E.R.A.L.D., S.H.I.E.L.D., D.R.O.I.D. → gemini-3.8-flash
--   I.N.S.I.G.H.T., M.E.T.R.I.C.                                     → Claude Sonnet 5
-- Osobny PR, po publikacji kodu obsługującego Gemini 3.x (#251, geminiCompat.ts,
-- podpisy myślenia w pętli narzędzi): stary kod gubiłby podpisy i narzędzia
-- na 3.8 Flash kończyłyby się HTTP 400. Migracja jest idempotentna.
UPDATE public.agents
SET model = CASE slug
  WHEN 'insight' THEN 'anthropic:claude-sonnet-5'
  WHEN 'metric' THEN 'anthropic:claude-sonnet-5'
  ELSE 'gemini-3.8-flash'
END
WHERE slug IN ('jarvis', 'insight', 'metric', 'forge', 'herald', 'shield', 'droid');

-- Pozostali agenci (gdyby jacyś byli) i model domyślny: z wycofanych 2.x na 3.8 Flash.
UPDATE public.agents
SET model = 'gemini-3.8-flash'
WHERE model IN ('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite');

UPDATE public.user_settings
SET default_model = 'gemini-3.8-flash'
WHERE default_model IN ('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite');

ALTER TABLE public.user_settings ALTER COLUMN default_model SET DEFAULT 'gemini-3.8-flash';
