// Agent Town — what agents say when you walk up and talk to them.
// Pure text builders over the real run data, so the dialog stays honest
// (nothing invented) and the wording is unit-tested.

import type { FlowRun } from "@/lib/agents/flow.functions";
import type { TownSlug } from "./townMap";

export const GREETING: Record<Exclude<TownSlug, "user">, string> = {
  jarvis: "Słucham. W czym mogę pomóc?",
  insight: "Archiwum do usług. Czego szukamy?",
  metric: "Liczby nie kłamią. Co policzyć?",
  forge: "Kuźnia rozgrzana. Co wykuwamy?",
  shield: "Wszystko pod kontrolą. Co sprawdzić?",
  herald: "Studio gotowe! O czym opowiadamy?",
};

const ACTIVE = new Set(["running", "pending"]);
/** H.E.R.A.L.D. is the presenter — Polish verbs agree with her. */
const FEMININE = new Set<TownSlug>(["herald"]);
const g = (slug: TownSlug, masc: string, fem: string) => (FEMININE.has(slug) ? fem : masc);

/** The task text a run was given: what its parent delegated to it. */
export function taskOf(run: FlowRun | undefined, runs: readonly FlowRun[]): string | null {
  if (!run?.parentRunId) return null;
  const parent = runs.find((r) => r.id === run.parentRunId);
  return parent?.delegations.find((d) => d.toSlug === run.agentSlug)?.task?.trim() || null;
}

const newestFirst = (a: FlowRun, b: FlowRun) => b.createdAt.localeCompare(a.createdAt);

export function durationLabel(run: FlowRun, now: number): string {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(run.createdAt)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/** Answer to "Jak idzie?". `currentTask` is the agent row's live task text, if any. */
export function statusLine(
  slug: TownSlug,
  runs: readonly FlowRun[],
  currentTask: string | null,
  enabled: boolean | undefined,
  now: number,
): string {
  if (enabled === false)
    return `Jestem ${g(slug, "wyłączony", "wyłączona")}. Włącz mnie w Agent Hub, a wrócę do pracy.`;
  const mine = runs.filter((r) => r.agentSlug === slug).sort(newestFirst);
  const active = mine.find((r) => ACTIVE.has(r.status));
  if (active) {
    const task = currentTask || taskOf(active, runs);
    const step = active.toolCalls[active.toolCalls.length - 1]?.name;
    return [
      task ? `Pracuję nad: „${task}”.` : "Właśnie nad czymś pracuję.",
      step ? `Ostatni krok: ${step}.` : "Dopiero zaczynam.",
      `Trwa to już ${durationLabel(active, now)}.`,
    ].join(" ");
  }
  const last = mine[0];
  if (!last) return `Dziś jeszcze nic nie ${g(slug, "robiłem", "robiłam")}. Mam wolne ręce.`;
  const task = taskOf(last, runs);
  if (last.status === "error")
    return task
      ? `Ostatnio coś nie wyszło przy: „${task}”. Szczegóły są w czacie.`
      : "Ostatnie zadanie skończyło się błędem. Szczegóły są w czacie.";
  return task
    ? `Mam wolne. Ostatnio ${g(slug, "zrobiłem", "zrobiłam")}: „${task}” (${durationLabel(last, now)}).`
    : `Mam wolne. Ostatnie zadanie zajęło ${durationLabel(last, now)}.`;
}

/** Answer to "Pokaż ostatni wynik". J.A.R.V.I.S. quotes his latest chat reply. */
export function lastResultLine(
  slug: TownSlug,
  runs: readonly FlowRun[],
  latestReply: string | null,
  now: number,
): string {
  if (slug === "jarvis" && latestReply) return latestReply;
  const last = runs
    .filter((r) => r.agentSlug === slug && !ACTIVE.has(r.status))
    .sort(newestFirst)[0];
  if (!last) return "Nie mam jeszcze żadnego wyniku do pokazania.";
  const task = taskOf(last, runs);
  const steps = last.toolCalls.map((t) => t.name);
  const what = task ? `„${task}”` : "ostatnie zadanie";
  const how = steps.length ? ` Kroki: ${steps.join(", ")}.` : "";
  const verdict = last.status === "error" ? "zakończone błędem" : "gotowe";
  return `${what}: ${verdict} w ${durationLabel(last, now)}.${how} Pełną treść znajdziesz w czacie.`;
}

/** "Got it!" in the right grammatical gender. */
export const accepted = (slug: TownSlug) => g(slug, "Przyjąłem!", "Przyjęłam!");
