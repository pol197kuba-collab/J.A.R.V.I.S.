// Content of the 3D landing page. Agent names and roles are the identities
// seeded by supabase/migrations/20260811120000_agent_identity_refactor.sql
// (the landing page is shown BEFORE login, so the per-user agents table cannot
// be read: this static registry mirrors it). Module titles come from
// modules.ts (MODULE_ITEMS); the one-line descriptions are the approved
// prototype copy, because modules.ts has none.

import { MODULE_ITEMS } from "@/components/jarvis/modules";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import type { IntroAgent } from "./createLoginScene";

export interface LandingAgent {
  slug: string;
  name: string;
  role: string;
  /** Prototype copy (data.js): there is no description source in the repo before login. */
  text: string;
}

/** The five teammates around J.A.R.V.I.S. (the sixth "agent" on the page is the core itself). */
export const LANDING_AGENTS: readonly LandingAgent[] = [
  {
    slug: AGENT_SLUGS.SHIELD,
    name: "S.H.I.E.L.D.",
    role: "Security & Compliance",
    text: "Monitoruje kondycję systemu: skanuje logi, wyłapuje błędy i nieudane uruchomienia agentów.",
  },
  {
    slug: AGENT_SLUGS.HERALD,
    name: "H.E.R.A.L.D.",
    role: "Strategy & Content",
    text: "Pisze hasła, posty i treści kampanii. Ton i długość dopasowuje do zadania.",
  },
  {
    slug: AGENT_SLUGS.INSIGHT,
    name: "I.N.S.I.G.H.T.",
    role: "Deep Research",
    text: "Robi głęboki research i wraca z materiałem, na którym reszta zespołu może pracować.",
  },
  {
    slug: AGENT_SLUGS.METRIC,
    name: "M.E.T.R.I.C.",
    role: "Performance Insights",
    text: "Analizuje Twoje dokumenty i przeszukuje je semantycznie, zamiast zgadywać.",
  },
  {
    slug: AGENT_SLUGS.FORGE,
    name: "F.O.R.G.E.",
    role: "Content Creation / Execution",
    text: "Kompiluje treść do gotowych plików: prezentacji, dokumentów Word i PDF.",
  },
];

export const JARVIS_CORE = {
  name: "J.A.R.V.I.S.",
  role: "Primary Brain / Core",
  text: "Rozmawiasz z jednym rdzeniem. On ocenia zadanie i deleguje je do właściwego specjalisty.",
} as const;

/** Total "agents" in the story: the core plus the teammates. */
export const LANDING_AGENT_TOTAL = LANDING_AGENTS.length + 1;

/** Static agents drawn on the landing page (all idle: no live data before login). */
export const landingIntroAgents = (): IntroAgent[] =>
  LANDING_AGENTS.map((a) => ({ slug: a.slug, name: a.name, role: a.role, busy: false }));

/** Prototype descriptions of the modules shown in the tunnel, keyed by modules.ts title. */
const MODULE_BLURBS: Record<string, string> = {
  Dashboard: "Poranny briefing, budżet i zadania",
  Mózg: "Mapa wiedzy 3D i mapa bazy danych",
  "Agent Town": "Pixel-artowe biuro na żywych danych",
  Wydatki: "Paragony zeskanowane w Vision",
  Paliwa: "Hurtowe ceny Orlenu od 2004 roku",
  Rynki: "Wykresy instrumentów i paper fund",
  Vision: "Kamera z nakładką HUD i skanerem",
  Zadania: "Kolejka, którą prowadzą agenci",
  Notatki: "Archiwum Twoje i J.A.R.V.I.S.-a",
  Dokumenty: "Baza pod wyszukiwanie M.E.T.R.I.C.-a",
  "Situation Room": "Dojazd do pracy: korki, objazdy i mapa trasy",
};

/** Approved one-line description of a module (modules.ts title), if it has one. */
export const moduleBlurb = (title: string): string | null => MODULE_BLURBS[title] ?? null;

export interface LandingModule {
  title: string;
  sub: string;
}

/**
 * Modules in the tunnel: the real app modules (modules.ts order) that have an
 * approved description. Modules without one (Agent Hub, System Logs, Settings,
 * J.A.R.V.I.S. itself) are not presented.
 */
export function landingModules(): LandingModule[] {
  return MODULE_ITEMS.filter((m) => MODULE_BLURBS[m.title]).map((m) => ({
    title: m.title,
    sub: MODULE_BLURBS[m.title],
  }));
}
