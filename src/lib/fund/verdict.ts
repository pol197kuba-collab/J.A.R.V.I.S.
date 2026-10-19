// FUNDUSZ — werdykt w prostych zdaniach nad rankingiem. Czysta logika.
//
// Liczby liczy kod, panel tylko je mówi. Najważniejsze pytanie funduszu:
// czy prognozy biją samo bycie na rynku (koszyk) i czy biją losowanie
// (małpa)? Przy krótkiej historii werdykt najpierw ostrzega, że to za mało.

import type { PlayerKind } from "./players";

/** Poniżej tylu dni historii każdy werdykt to raczej szum niż wynik. */
export const MIN_DAYS_FOR_VERDICT = 14;

export type VerdictPlayer = {
  key: string;
  label: string;
  kind: PlayerKind;
  returnPct: number;
  /** Gracz-źródło bez żadnej prognozy — nie gra, więc nie wchodzi do rankingu. */
  waiting?: boolean;
};

/**
 * Gracz-źródło, który jeszcze nie dostał ani jednej prognozy. Jego 0% to nie
 * wynik, tylko brak gry — w rankingu stałby wyżej niż gracze na minusie.
 * Starsze portfele (bez licznika sygnałów) rozpoznajemy po zerze transakcji.
 */
export function isWaiting(p: {
  kind: PlayerKind;
  metrics: { trades: number; signals?: number } | null;
}): boolean {
  if (p.kind !== "source") return false;
  if (!p.metrics) return true;
  return p.metrics.signals !== undefined ? p.metrics.signals === 0 : p.metrics.trades === 0;
}

/** Na co czeka gracz, który nie gra — po polsku, do panelu i werdyktu. */
export const waitingFor = (key: string): string =>
  key === "ai_learned" ? "wnioski z rozliczonych prognoz" : "prognozy";

const num = (v: number, digits: number): string =>
  Math.abs(v).toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const sign = (v: number): string => (v >= 0 ? "+" : "−");
const pp = (v: number): string => `${sign(v)}${num(v, 1)} pp`;

export function fundVerdict(players: VerdictPlayer[], days: number): string[] {
  if (players.length === 0) return [];
  const lines: string[] = [];
  if (days < MIN_DAYS_FOR_VERDICT) {
    lines.push(
      `Za wcześnie na wnioski: ${days} ${days === 1 ? "dzień" : "dni"} historii. Uczciwy werdykt po ok. ${MIN_DAYS_FOR_VERDICT} dniach.`,
    );
  }
  const playing = players.filter((p) => !p.waiting);
  const ranked = [...playing].sort((a, b) => b.returnPct - a.returnPct);
  const top = ranked[0];
  if (top) lines.push(`Prowadzi: ${top.label} (${sign(top.returnPct)}${num(top.returnPct, 2)}%).`);

  const basket = players.find((p) => p.kind === "benchmark");
  const monkey = players.find((p) => p.kind === "monkey");
  for (const p of players.filter((x) => x.kind === "source")) {
    if (p.waiting) {
      lines.push(`${p.label}: jeszcze nie gra — czeka na ${waitingFor(p.key)}.`);
      continue;
    }
    const parts: string[] = [];
    if (basket) {
      const d = p.returnPct - basket.returnPct;
      parts.push(d >= 0 ? `bije koszyk (${pp(d)})` : `przegrywa z koszykiem (${pp(d)})`);
    }
    if (monkey) {
      const d = p.returnPct - monkey.returnPct;
      parts.push(d >= 0 ? `bije małpę (${pp(d)})` : `przegrywa z małpą (${pp(d)})`);
    }
    if (parts.length > 0) lines.push(`${p.label}: ${parts.join(", ")}.`);
  }
  return lines;
}
