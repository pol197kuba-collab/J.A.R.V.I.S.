-- =========================================================================
-- Optional Google Custom Search credentials for real-photo lookup in
-- generated documents (F.O.R.G.E.). This is a self-serve upgrade: without
-- these set, image resolution still works via the free tiers (Wikipedia,
-- og:image web lookup, Openverse CC search, AI-generation fallback) — when
-- present, Google Custom Search's dedicated image search is tried FIRST,
-- since it's the most accurate/broad option, for a user who wants to set
-- one up (console.cloud.google.com — 100 free queries/day, then paid).
-- =========================================================================

ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS google_cse_api_key TEXT;
ALTER TABLE public.user_secrets ADD COLUMN IF NOT EXISTS google_cse_cx TEXT;
