// Mózg 3D — ślad RAG: które gwiazdy trafiły do odpowiedzi J.A.R.V.I.S.a.
// Budowany w narzędziach `recall` i `search_documents`, czytany przez /mozg.
// Czysta logika, bez I/O.

import type { BrainSourceType } from "./layout";

export type TraceItem = { type: BrainSourceType; id: string; score: number | null };

/** Więcej gwiazd w jednym śladzie i tak nie da się czytelnie narysować. */
export const MAX_TRACE_ITEMS = 25;

/**
 * Scala trafienia w ślad: jedna pozycja na gwiazdę (dokument z kilkoma
 * trafionymi fragmentami = jedna gwiazda z najlepszym wynikiem), kolejność
 * od najlepszego, bez pustych id. Trafienia bez wyniku (z wyszukiwania po
 * słowach) idą na koniec.
 */
export function buildTraceItems(hits: TraceItem[]): TraceItem[] {
  const best = new Map<string, TraceItem>();
  for (const h of hits) {
    if (!h.id) continue;
    const key = `${h.type}:${h.id}`;
    const prev = best.get(key);
    const score = typeof h.score === "number" && Number.isFinite(h.score) ? h.score : null;
    if (!prev || (score ?? -1) > (prev.score ?? -1)) best.set(key, { ...h, score });
  }
  return [...best.values()]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, MAX_TRACE_ITEMS);
}

/** Pozycje śladu z JSONB — odrzuca wszystko, co nie wygląda na gwiazdę. */
export function parseTraceItems(raw: unknown): TraceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TraceItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { type, id, score } = r as Record<string, unknown>;
    if (type !== "memory" && type !== "note" && type !== "document") continue;
    if (typeof id !== "string" || !id) continue;
    out.push({ type, id, score: typeof score === "number" ? score : null });
  }
  return out;
}
