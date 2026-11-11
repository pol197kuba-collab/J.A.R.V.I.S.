// Budżet miesięczny — czysta decyzja, co zrobić przy danym stanie wydatków.
//
// WYBÓR PROJEKTOWY: DEGRADACJA, NIE BLOKADA. Po przekroczeniu limitu system
// nie odmawia pracy, tylko schodzi na tańszy model. Twarde „nie" o ósmej
// wieczorem znaczyłoby, że J.A.R.V.I.S. milknie w środku rozmowy — a po
// dwóch takich wieczorach limit i tak zostałby podniesiony, czyli
// zabezpieczenie zniknęłoby zamiast zadziałać. Tańszy model odpowiada dalej,
// tylko za ułamek ceny.
//
// PRÓG OSTRZEGAWCZY ISTNIEJE PO TO, ŻEBY DEGRADACJA NIE BYŁA NIESPODZIANKĄ.
// Zmiana modelu w połowie miesiąca bez zapowiedzi wygląda jak awaria
// („dlaczego on nagle głupieje"). Ostrzeżenie przy 80% daje czas, żeby
// podnieść limit, zanim cokolwiek się zmieni.
import { bareModelId } from "./pricing";

/** Od jakiego udziału limitu ostrzegamy. */
export const WARN_AT = 0.8;

export type BudgetLevel = "ok" | "warn" | "over";

export type BudgetStatus = {
  level: BudgetLevel;
  /** Wydane w tym miesiącu, USD. */
  spentUsd: number;
  /** Limit miesięczny, USD; 0 znaczy „bez limitu". */
  limitUsd: number;
  /** Udział limitu, 0-1+. Zwraca 0 przy limicie wyłączonym. */
  ratio: number;
};

export function budgetStatus(spentUsd: number, limitUsd: number): BudgetStatus {
  const spent = Math.max(0, spentUsd);
  // Limit zero to świadome „nie pilnuj", a nie „zablokuj wszystko" — dzielenie
  // przez zero dałoby nieskończoność i natychmiastową degradację wszystkiego.
  if (!(limitUsd > 0)) return { level: "ok", spentUsd: spent, limitUsd: 0, ratio: 0 };

  const ratio = spent / limitUsd;
  const level: BudgetLevel = ratio >= 1 ? "over" : ratio >= WARN_AT ? "warn" : "ok";
  return { level, spentUsd: spent, limitUsd, ratio };
}

/**
 * Model, na który schodzimy po przekroczeniu limitu.
 *
 * Jeden stopień w dół, nie od razu na dno: Opus → Sonnet zachowuje jakość
 * przy 2,5-krotnie niższej cenie, a dopiero Sonnet → Gemini Flash jest
 * skokiem, który widać. Zejście od razu na Flasha oszczędzałoby więcej i
 * kosztowało dokładnie tę różnicę w jakości, której limit miał bronić.
 */
const DOWNGRADE: Readonly<Record<string, string>> = {
  "claude-opus-5": "anthropic:claude-sonnet-5",
  "claude-sonnet-5": "anthropic:claude-haiku-4-5",
  "claude-haiku-4-5": "gemini-2.5-flash",
  "gemini-2.5-pro": "gemini-2.5-flash",
  "gemini-pro-latest": "gemini-2.5-flash",
};

export type ModelDecision = {
  model: string;
  /** Czy budżet zmienił wybór — do pokazania i do zalogowania. */
  downgraded: boolean;
  /** Model, o który pierwotnie proszono; równy `model`, gdy nic nie zmieniono. */
  requested: string;
};

/**
 * Wybiera model z uwzględnieniem budżetu.
 *
 * Poniżej limitu nie rusza niczego — także przy ostrzeżeniu. Ostrzeżenie ma
 * informować, nie działać; gdyby zmieniało model, próg 80% byłby faktycznym
 * limitem, a liczba w ustawieniach nie znaczyłaby tego, co mówi.
 */
export function chooseModel(requested: string, status: BudgetStatus): ModelDecision {
  if (status.level !== "over") return { model: requested, downgraded: false, requested };

  const cheaper = DOWNGRADE[bareModelId(requested)];
  // Model bez tańszego odpowiednika (albo już najtańszy) zostaje jak jest —
  // nie ma dokąd schodzić, a odmowa pracy nie jest tu opcją.
  if (!cheaper) return { model: requested, downgraded: false, requested };

  return { model: cheaper, downgraded: true, requested };
}

/** Zdanie do powiadomienia i do briefingu. */
export function budgetMessage(status: BudgetStatus): string | null {
  if (status.limitUsd <= 0) return null;
  const pct = Math.round(status.ratio * 100);
  if (status.level === "over") {
    return `Limit miesięczny wyczerpany (${pct}% z $${status.limitUsd}). Agenci pracują na tańszych modelach do końca miesiąca.`;
  }
  if (status.level === "warn") {
    return `Zużyto ${pct}% miesięcznego limitu ($${status.limitUsd}). Po przekroczeniu agenci zejdą na tańsze modele.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wydatki z księgi llm_usage (etap 2: A3/A12). Wiersze przychodzą już
// zsumowane przez bazę (funkcja llm_spend_by_module, grupy moduł × model);
// tu tylko składamy sumy i dwa podziały — z TYCH SAMYCH wierszy, więc
// podział w panelu zawsze sumuje się do kwoty budżetu.
// ---------------------------------------------------------------------------

export type SpendByModuleRow = {
  module: string;
  model: string;
  cost_usd: number;
  calls: number;
  unpriced: number;
  today_usd: number;
};

export type SpendRow = { key: string; label: string; costUsd: number; runs: number };

export type SpendSummary = {
  spentUsd: number;
  todayUsd: number;
  calls: number;
  unpriced: number;
  byModule: SpendRow[];
  byModel: SpendRow[];
};

const MODULE_LABELS: Readonly<Record<string, string>> = {
  agents: "Agenci i czat",
  "agents (przed księgą)": "Czat (przed księgą)",
  markets: "Rynki",
  brief: "Briefing",
  vision: "Vision",
  brain: "Mózg",
  fuel: "Paliwa",
  documents: "Dokumenty",
  notes: "Notatki",
};

export const moduleLabel = (module: string): string => MODULE_LABELS[module] ?? module;

/** Największe pozycje na wierzchu; drobnica i tak nie zmieni decyzji. */
const topBySpend = (rows: Iterable<SpendRow>, limit = 8): SpendRow[] =>
  [...rows].sort((a, b) => b.costUsd - a.costUsd).slice(0, limit);

export function summarizeSpend(rows: readonly SpendByModuleRow[]): SpendSummary {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const byModule = new Map<string, SpendRow>();
  const byModel = new Map<string, SpendRow>();
  let spentUsd = 0;
  let todayUsd = 0;
  let calls = 0;
  let unpriced = 0;
  for (const r of rows) {
    const cost = num(r.cost_usd);
    const n = num(r.calls);
    spentUsd += cost;
    todayUsd += num(r.today_usd);
    calls += n;
    unpriced += num(r.unpriced);
    const m = byModule.get(r.module) ?? {
      key: r.module,
      label: moduleLabel(r.module),
      costUsd: 0,
      runs: 0,
    };
    m.costUsd += cost;
    m.runs += n;
    byModule.set(r.module, m);
    const modelKey = bareModelId(r.model || "—");
    const md = byModel.get(modelKey) ?? { key: modelKey, label: modelKey, costUsd: 0, runs: 0 };
    md.costUsd += cost;
    md.runs += n;
    byModel.set(modelKey, md);
  }
  return {
    spentUsd,
    todayUsd,
    calls,
    unpriced,
    byModule: topBySpend(byModule.values()),
    byModel: topBySpend(byModel.values()),
  };
}
