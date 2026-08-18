-- Dev Wing, groundwork for Phase 2: BYOK storage for a GitHub Personal
-- Access Token, mirroring gemini_api_key/groq_api_key exactly (same table,
-- same RLS policy already covers it — no new grants/policies needed).
-- Used server-side only by the future D.R.O.I.D. coordinator to create
-- issues (and later read PR/issue status) on the user's behalf in whichever
-- repo a project points at — never sent to the browser.
ALTER TABLE public.user_secrets ADD COLUMN github_token text;
