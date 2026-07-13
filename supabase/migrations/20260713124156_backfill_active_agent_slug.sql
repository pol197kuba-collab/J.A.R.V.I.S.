-- Backfills a migration for public.user_settings.active_agent_slug, which
-- already exists on the live database (confirmed via a live schema export
-- on 2026-07-13) but was never captured in a migration file — exactly the
-- git/live drift CODEX.md warns about. Used by getActiveConversation /
-- setActiveAgent in src/lib/agents/runtime.functions.ts to remember which
-- agent the user last talked to. IF NOT EXISTS makes this a no-op on the
-- live DB (already has the column) while making a from-scratch rebuild
-- (staging, CI, disaster recovery) match production.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS active_agent_slug text NOT NULL DEFAULT 'orchestrator';
