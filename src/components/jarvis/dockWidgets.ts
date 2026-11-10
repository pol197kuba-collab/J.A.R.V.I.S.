// What the mobile dock's mini widgets say. Pure: query data in, short lines
// out. Every number comes from real data already fetched by the app (agents,
// open tasks, the paper fund) — nothing is invented; no data → no line.

import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

export type DotState = "busy" | "error" | "idle";
export type AgentDot = { slug: string; name: string; state: DotState };

type AgentLike = { slug: string; name: string; status: string; isEnabled: boolean };

/** One dot per enabled teammate (the core itself excluded), in registry order. */
export function agentDots(rows: readonly AgentLike[] | undefined): AgentDot[] {
  if (!rows) return [];
  return rows
    .filter((a) => a.slug !== AGENT_SLUGS.JARVIS && a.isEnabled)
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      state: a.status === "error" ? "error" : a.status === "busy" ? "busy" : "idle",
    }));
}

/** The reactor in the dock: spins up while anyone works, turns red on an error. */
export function reactorState(dots: readonly AgentDot[]): DotState {
  if (dots.some((d) => d.state === "error")) return "error";
  if (dots.some((d) => d.state === "busy")) return "busy";
  return "idle";
}

/** Polish plural: 1 zadanie, 2–4 zadania, 5+ zadań (12–14 → zadań). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

export function tasksLine(openCount: number | null | undefined): string | null {
  if (openCount === null || openCount === undefined) return null;
  if (openCount === 0) return "brak otwartych zadań";
  return `${openCount} ${plural(openCount, "otwarte zadanie", "otwarte zadania", "otwartych zadań")}`;
}

export function fundLine(dayPct: number | null | undefined): string | null {
  if (dayPct === null || dayPct === undefined || !Number.isFinite(dayPct)) return null;
  const v = dayPct.toFixed(2).replace(".", ",");
  return `fundusz ${dayPct > 0 ? "+" : ""}${v}% dziś`;
}

export function agentsLine(dots: readonly AgentDot[]): string | null {
  if (!dots.length) return null;
  const busy = dots.filter((d) => d.state === "busy").length;
  const err = dots.filter((d) => d.state === "error").length;
  if (err) return `${err} ${plural(err, "agent z błędem", "agentów z błędem", "agentów z błędem")}`;
  if (busy) return `${busy} ${plural(busy, "agent pracuje", "agentów pracuje", "agentów pracuje")}`;
  return "agenci w gotowości";
}

/**
 * "Praca: 31 min, +4" — the commute in one line. No data → no line; a delay
 * under 3 min is noise and stays out.
 */
export function commuteLine(
  c: { direction: "to" | "back"; durationMin: number; delayMin: number | null } | null | undefined,
): string | null {
  if (!c || !Number.isFinite(c.durationMin)) return null;
  const where = c.direction === "to" ? "Praca" : "Dom";
  const delay = c.delayMin !== null && c.delayMin >= 3 ? `, +${c.delayMin}` : "";
  return `${where}: ${c.durationMin} min${delay}`;
}

/** The context line under the module name: the module's own number, else open tasks. */
export function dockLine(
  pathname: string,
  d: {
    fundDayPct?: number | null;
    openTasks?: number | null;
    dots: readonly AgentDot[];
    commute?: string | null;
  },
): string | null {
  if (pathname === "/situation-room") return d.commute ?? tasksLine(d.openTasks);
  if (pathname === "/") return d.commute ?? tasksLine(d.openTasks) ?? agentsLine(d.dots);
  if (pathname === "/rynki") return fundLine(d.fundDayPct) ?? tasksLine(d.openTasks);
  if (pathname === "/agent-hub" || pathname === "/jarvis") return agentsLine(d.dots);
  return tasksLine(d.openTasks) ?? agentsLine(d.dots);
}
