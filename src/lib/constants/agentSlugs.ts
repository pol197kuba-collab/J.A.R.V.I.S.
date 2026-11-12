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

// Wszyscy agenci, którzy istnieją w bazie. D.R.O.I.D. (migracja
// 20260817220000_droid_agent) nie ma wpisu w AGENT_SLUGS, bo od niego zależy
// typ TownSlug, a Town nie ma jeszcze dla niego pokoju.
const KNOWN_SLUGS: ReadonlySet<string> = new Set([...Object.values(AGENT_SLUGS), "droid"]);

/** Czy to slug istniejącego agenta (zestaw agentów jest stały — patrz wyżej). */
export function isAgentSlug(slug: unknown): slug is string {
  return typeof slug === "string" && KNOWN_SLUGS.has(slug);
}

// Tools an agent must always have declared to the model in-memory,
// regardless of its DB tool bindings (public.agent_tools) — e.g. F.O.R.G.E.
// is useless without generate_document, and J.A.R.V.I.S. needs
// delegate_to_agent to hand off work to teammates. A missing/unapplied DB
// migration must never silently remove one of these. Adding a forced tool
// for another agent is a single entry here; how that tool's declaration is
// actually built (registry lookup vs. an inline dynamic declaration) is
// still up to the call site in runtime.server.ts.
export const FORCED_TOOLS_BY_SLUG: Readonly<Record<string, readonly string[]>> = {
  [AGENT_SLUGS.FORGE]: ["generate_document"],
  [AGENT_SLUGS.JARVIS]: ["delegate_to_agent"],
};

export function isToolForcedForAgent(slug: string, toolName: string): boolean {
  return FORCED_TOOLS_BY_SLUG[slug]?.includes(toolName) ?? false;
}
