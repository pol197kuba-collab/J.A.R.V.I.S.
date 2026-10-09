// Agent Town — reading real data for the map: why a run failed and how to
// retry it, whether an AI provider is refusing requests, what happened since
// your last visit, and the time of day. Pure (tested); nothing here invents
// activity — every line is built from runs and notifications.

import type { FlowRun } from "@/lib/agents/flow.functions";
import type { AppNotification } from "@/lib/notifications/notifications.functions";
import { isTownAgent, type TownSlug } from "./townMap";

// ── errors ──────────────────────────────────────────────────────────────────

export type ErrorKind = "credits" | "rate" | "auth" | "timeout" | "network" | "other";
export type Provider = "Anthropic" | "Gemini" | "Groq" | "OpenAI";

export function errorKind(msg: string): ErrorKind {
  const m = msg.toLowerCase();
  if (/credit|balance|billing|insufficient|payment|quota exceeded|\b402\b/.test(m))
    return "credits";
  if (/\b429\b|rate.?limit|too many requests|overloaded|\b529\b|resource.?exhausted/.test(m))
    return "rate";
  if (/\b401\b|\b403\b|api.?key|unauthori[sz]ed|permission denied|forbidden/.test(m)) return "auth";
  if (/time.?out|timed out|etimedout|aborted|deadline/.test(m)) return "timeout";
  if (/fetch failed|econn|enotfound|network|socket|\b50[234]\b/.test(m)) return "network";
  return "other";
}

export function providerOf(text: string | null | undefined): Provider | null {
  const t = (text ?? "").toLowerCase();
  if (/anthropic|claude/.test(t)) return "Anthropic";
  if (/gemini|google|generativelanguage/.test(t)) return "Gemini";
  if (/groq|llama/.test(t)) return "Groq";
  if (/openai|gpt-/.test(t)) return "OpenAI";
  return null;
}

const KIND_TEXT: Record<ErrorKind, { title: string; hint: string }> = {
  credits: {
    title: "Brak środków u dostawcy AI",
    hint: "Doładuj konto u dostawcy albo przełącz agenta na innego dostawcę w Agent Hub.",
  },
  rate: {
    title: "Dostawca AI chwilowo odmawia (limit zapytań)",
    hint: "Zwykle mija po chwili — ponów za minutę.",
  },
  auth: {
    title: "Klucz API odrzucony",
    hint: "Sprawdź klucz dostawcy w ustawieniach (Agent Hub / sekrety).",
  },
  timeout: {
    title: "Zadanie trwało za długo",
    hint: "Spróbuj ponowić albo podzielić polecenie na mniejsze kroki.",
  },
  network: {
    title: "Problem z połączeniem",
    hint: "Usługa była niedostępna — ponów za chwilę.",
  },
  other: {
    title: "Zadanie się nie powiodło",
    hint: "Szczegóły poniżej; możesz spróbować ponownie.",
  },
};

/** "Co się stało?" — a plain-language reading of a run's error. */
export function explainError(msg: string | null | undefined): string {
  const raw = (msg ?? "").trim() || "Brak komunikatu błędu.";
  const k = KIND_TEXT[errorKind(raw)];
  const who = providerOf(raw);
  return `${k.title}${who ? ` (${who})` : ""}.\n${k.hint}\n\nKomunikat: ${raw.slice(0, 300)}`;
}

/** The agent's newest run, if it failed. */
export function failedRunOf(slug: TownSlug, runs: readonly FlowRun[]): FlowRun | null {
  const last = runs
    .filter((r) => r.agentSlug === slug)
    .reduce<FlowRun | null>((a, r) => (!a || r.createdAt > a.createdAt ? r : a), null);
  return last?.status === "error" ? last : null;
}

/** How to retry a failed run: the same words, to the same agent. */
export function retryPlan(
  run: FlowRun,
  runs: readonly FlowRun[],
): { text: string; to: TownSlug | "auto" } | null {
  if (run.parentRunId) {
    const parent = runs.find((r) => r.id === run.parentRunId);
    const task =
      parent?.delegations.find((d) => d.toSlug === run.agentSlug)?.task?.trim() ||
      run.inputText?.trim();
    if (!task || !isTownAgent(run.agentSlug)) return null;
    return { text: task, to: run.agentSlug === "jarvis" ? "auto" : run.agentSlug };
  }
  const text = run.inputText?.trim();
  return text ? { text, to: "auto" } : null;
}

// ── AI providers (the Vault) ────────────────────────────────────────────────

export type ProviderTrouble = {
  provider: Provider | null;
  kind: ErrorKind;
  at: string;
  message: string;
};

/**
 * A provider that is refusing requests: the newest credits / auth / rate
 * error in the last 24 h, unless a later run already succeeded on that
 * provider (or, when the error doesn't say which provider, on any).
 */
export function providerTrouble(runs: readonly FlowRun[], now: number): ProviderTrouble | null {
  const recent = runs.filter((r) => now - Date.parse(r.createdAt) < 24 * 3600_000);
  const errors = recent
    .filter((r) => r.status === "error" && r.error)
    .filter((r) => ["credits", "auth", "rate"].includes(errorKind(r.error!)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const e = errors[0];
  if (!e) return null;
  const provider = providerOf(e.error);
  const recovered = recent.some(
    (r) =>
      r.status === "done" &&
      r.createdAt > e.createdAt &&
      (!provider || providerOf(r.model) === provider),
  );
  if (recovered) return null;
  return { provider, kind: errorKind(e.error!), at: e.createdAt, message: e.error! };
}

// ── since your last visit ───────────────────────────────────────────────────

const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
};

const KIND_LABEL: Record<string, string> = {
  standing_order: "meldunki zadań cyklicznych",
  fuel_alert: "alerty paliwowe",
  document_ready: "gotowe dokumenty",
  document_failed: "dokumenty z błędem",
  town_result: "wyniki na tablicy",
};

/**
 * J.A.R.V.I.S.'s report when you come back: finished and failed requests,
 * the busiest agent, and the notifications that came in. Null when nothing
 * happened. `runs` is the flow feed (its newest 40), so when it doesn't
 * reach back to `since` the counts say "co najmniej".
 */
export function visitReport(
  runs: readonly FlowRun[],
  notifications: readonly AppNotification[],
  since: number,
  name: (slug: TownSlug) => string,
): string[] | null {
  const after = (iso: string | null) => !!iso && Date.parse(iso) > since;
  const roots = runs.filter((r) => !r.parentRunId && after(r.finishedAt));
  const done = roots.filter((r) => r.status === "done").length;
  const failed = roots.filter((r) => r.status === "error").length;
  const all = runs.filter((r) => after(r.finishedAt));
  const reachesBack = runs.some((r) => Date.parse(r.createdAt) <= since) || runs.length < 40;
  const lines: string[] = [];
  if (done || failed) {
    const pre = reachesBack ? "" : "co najmniej ";
    lines.push(
      `Polecenia: ${pre}${done} ${plural(done, "zakończone", "zakończone", "zakończonych")}` +
        (failed ? `, ${failed} z błędem.` : "."),
    );
    const per = new Map<string, number>();
    for (const r of all) per.set(r.agentSlug, (per.get(r.agentSlug) ?? 0) + 1);
    const top = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && isTownAgent(top[0]))
      lines.push(`Najwięcej pracował(a): ${name(top[0])} (${top[1]}).`);
  }
  const fresh = notifications.filter((n) => after(n.createdAt) && n.kind !== "town_result");
  if (fresh.length) {
    const byKind = new Map<string, number>();
    for (const n of fresh) byKind.set(n.kind, (byKind.get(n.kind) ?? 0) + 1);
    lines.push(
      "Powiadomienia: " +
        [...byKind.entries()].map(([k, c]) => `${KIND_LABEL[k] ?? k} — ${c}`).join(", ") +
        ".",
    );
    const newest = [...fresh].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    lines.push(`Ostatnie: „${newest.title}”.`);
  }
  return lines.length ? lines : null;
}

// ── time of day ─────────────────────────────────────────────────────────────

/** 0 = day, 1 = full night: dusk 18–21, dawn 5–7, by the local clock. */
export function nightLevel(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 18 && h < 21) return (h - 18) / 3;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 1;
}
