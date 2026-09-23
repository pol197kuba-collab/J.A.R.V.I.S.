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
