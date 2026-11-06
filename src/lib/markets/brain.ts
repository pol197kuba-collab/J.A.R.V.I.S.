// MÓZG AI — podsumowanie tego, czego „AI z wnioskami” się nauczyło i czy to
// działa. Czysta logika, bez I/O (dane: markets.functions.ts → getAiBrain).
//
// HISTORIA WNIOSKÓW bez osobnej tabeli: każda prognoza „AI z wnioskami”
// zapisuje w market_predictions.lessons dokładnie te zdania, które widział
// model. Zdanie zmienia liczby z dnia na dzień („trafiły 5 z 69” → „6 z 71”),
// więc tożsamość wniosku = zdanie z liczbami zastąpionymi „#”.

import { assetBySymbol } from "./assets";

/** Tożsamość wniosku niezależna od liczb w zdaniu. */
export function lessonKey(text: string): string {
  return text
    .replace(/[−+-]?\d+(?:[.,]\d+)?\s*%?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type LessonSpan = {
  key: string;
  /** Najnowsza treść zdania. */
  text: string;
  /** Pierwszy i ostatni dzień, w którym model dostał ten wniosek (YYYY-MM-DD). */
  firstSeen: string;
  lastSeen: string;
  /** W ilu dniach model go dostał. */
  days: number;
  /** Czy jest wśród dzisiejszych wniosków. */
  active: boolean;
};

/**
 * Prognozy „AI z wnioskami” (dzień + zdania, które widział model) → oś czasu
 * każdego wniosku. `current` = dzisiejsze wnioski (aktywne nawet wtedy, gdy
 * jeszcze żadna prognoza ich nie użyła). Aktywne najpierw, potem od
 * najpóźniej widzianych.
 */
export function lessonTimeline(
  rows: ReadonlyArray<{ madeOn: string; lessons: readonly string[] }>,
  current: readonly string[],
  today: string,
): LessonSpan[] {
  const spans = new Map<string, LessonSpan & { daySet: Set<string> }>();
  for (const r of [...rows].sort((a, b) => a.madeOn.localeCompare(b.madeOn))) {
    for (const text of new Set(r.lessons)) {
      const key = lessonKey(text);
      const s = spans.get(key);
      if (!s) {
        spans.set(key, {
          key,
          text,
          firstSeen: r.madeOn,
          lastSeen: r.madeOn,
          days: 1,
          active: false,
          daySet: new Set([r.madeOn]),
        });
        continue;
      }
      s.text = text;
      s.lastSeen = r.madeOn;
      s.daySet.add(r.madeOn);
      s.days = s.daySet.size;
    }
  }
  for (const text of current) {
    const key = lessonKey(text);
    const s = spans.get(key);
    if (s) {
      s.active = true;
      s.text = text;
    } else {
      spans.set(key, {
        key,
        text,
        firstSeen: today,
        lastSeen: today,
        days: 0,
        active: true,
        daySet: new Set(),
      });
    }
  }
  return [...spans.values()]
    .map(({ daySet: _d, ...s }) => s)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.lastSeen.localeCompare(a.lastSeen) ||
        a.firstSeen.localeCompare(b.firstSeen),
    );
}

export type BrainPrediction = {
  symbol: string;
  madeOn: string;
  source: string;
  direction: string;
  confidence: number;
  rationalePl: string | null;
  outcome: "hit" | "miss" | null;
  actualChangePct: number | null;
};

export type Divergence = {
  symbol: string;
  label: string;
  madeOn: string;
  plain: BrainPrediction;
  learned: BrainPrediction;
};

/**
 * Wnioski w akcji: ten sam instrument i dzień, a „AI z wnioskami” wskazało
 * inny kierunek niż zwykłe „AI” (ten sam model i prompt, bez wniosków) —
 * tam widać, co wnioski zmieniły. Od najnowszych.
 */
export function divergences(rows: readonly BrainPrediction[], limit = 8): Divergence[] {
  const plain = new Map<string, BrainPrediction>();
  for (const r of rows) if (r.source === "ai") plain.set(`${r.symbol}|${r.madeOn}`, r);
  const out: Divergence[] = [];
  for (const r of rows) {
    if (r.source !== "ai_learned") continue;
    const p = plain.get(`${r.symbol}|${r.madeOn}`);
    if (!p || p.direction === r.direction) continue;
    out.push({
      symbol: r.symbol,
      label: assetBySymbol(r.symbol)?.label ?? r.symbol,
      madeOn: r.madeOn,
      plain: p,
      learned: r,
    });
  }
  return out
    .sort((a, b) => b.madeOn.localeCompare(a.madeOn) || a.label.localeCompare(b.label, "pl"))
    .slice(0, limit);
}

/** Bilans rozbieżności: ile razy rację miały wnioski, a ile zwykłe AI (rozliczone). */
export function divergenceScore(list: readonly Divergence[]): {
  settled: number;
  learnedRight: number;
  plainRight: number;
} {
  let settled = 0;
  let learnedRight = 0;
  let plainRight = 0;
  for (const d of list) {
    if (!d.learned.outcome || !d.plain.outcome) continue;
    settled += 1;
    if (d.learned.outcome === "hit") learnedRight += 1;
    if (d.plain.outcome === "hit") plainRight += 1;
  }
  return { settled, learnedRight, plainRight };
}

/** Z czego się uczy: rozliczone prognozy w oknie wniosków, wg gracza i klasy. */
export function learningFunnel(rows: ReadonlyArray<{ source: string; symbol: string }>): {
  total: number;
  bySource: Record<string, number>;
  byClass: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const cls = assetBySymbol(r.symbol)?.assetClass ?? "other";
    byClass[cls] = (byClass[cls] ?? 0) + 1;
  }
  return { total: rows.length, bySource, byClass };
}
