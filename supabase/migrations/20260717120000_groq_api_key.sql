-- Multi-provider AI routing, step 1: BYOK storage for a Groq API key,
-- mirroring the existing gemini_api_key column exactly (same table, same
-- RLS policy already covers it — no new grants/policies needed).
ALTER TABLE public.user_secrets ADD COLUMN groq_api_key text;
