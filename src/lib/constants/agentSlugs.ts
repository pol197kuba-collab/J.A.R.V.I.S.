// Canonical agent slug identifiers — single source of truth.
//
// These values must match `public.agents.slug` rows in the live database
// (see supabase/migrations/20260811120000_agent_identity_refactor.sql for
// the current identity set). Renaming an agent still requires updating both
// the DB row and this file — this constant only removes the risk of a typo
// or a missed literal string across the many call sites that compare
// against an agent's slug.
export const AGENT_SLUGS = {
  JARVIS: "jarvis",
  SHIELD: "shield",
  HERALD: "herald",
  INSIGHT: "insight",
  METRIC: "metric",
  FORGE: "forge",
} as const;

export type AgentSlug = (typeof AGENT_SLUGS)[keyof typeof AGENT_SLUGS];
