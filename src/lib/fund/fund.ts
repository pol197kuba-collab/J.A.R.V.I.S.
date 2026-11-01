// FUNDUSZ — prognozy z bazy → wszyscy gracze naraz. Czysta logika.
//
// Start = dzień pierwszej prognozy w bazie (prognozy powstawały na bieżąco,
// więc odtworzenie handlu od tego dnia nie zagląda w przyszłość). Jedna
// prognoza = jedno źródło × instrument × dzień (unikat w market_predictions).

import { assetBySymbol } from "@/lib/markets/assets";
import type { PricePoint } from "@/lib/markets/series";
import {
  DEFAULT_RULES,
  simulate,
  type Direction,
  type FundSignal,
  type Instrument,
  type LiveEvent,
  type SimResult,
} from "./engine";
import { computeMetrics, type FundMetrics } from "./metrics";
import { basketSignals, monkeySignals, PLAYERS, type PlayerDef } from "./players";

export type PredictionRow = {
  id: string;
  symbol: string;
  source: string;
  made_on: string;
  direction: string;
  confidence: number;
  rationale_pl: string | null;
  /** Brak = 7 (wiersze sprzed horyzontu dwudniowego). */
  horizon_days?: number;
  /** Chwila postawienia (ISO) — pozwala na realizację w ciągu dnia. */
  made_at?: string | null;
};

export type PlayerResult = PlayerDef & { result: SimResult; metrics: FundMetrics };

export type FundRun = { start: string; end: string; players: PlayerResult[] };

const isDirection = (d: string): d is Direction => d === "up" || d === "down" || d === "flat";

export function toSignal(p: PredictionRow): FundSignal | null {
  if (!isDirection(p.direction)) return null;
  return {
    symbol: p.symbol,
    madeOn: p.made_on,
    direction: p.direction,
    confidence: p.confidence,
    reason: p.rationale_pl,
    predictionId: p.id,
    horizonDays: p.horizon_days ?? 7,
    ...(p.made_at ? { madeAt: p.made_at } : {}),
  };
}

/** Instrumenty z prognoz + pary walutowe potrzebne do wyceny w PLN. */
export function instrumentsFor(symbols: Iterable<string>): Map<string, Instrument> {
  const out = new Map<string, Instrument>();
  for (const s of [...symbols, "USDPLN", "EURPLN"]) {
    const a = assetBySymbol(s);
    if (a) out.set(s, { assetClass: a.assetClass, currency: a.currency });
  }
  return out;
}

export function buildFund(
  predictions: PredictionRow[],
  closes: Map<string, PricePoint[]>,
  end: string,
  /** Zdarzenia z przebiegu na żywo, per gracz (klucz = PLAYERS.key). */
  events: Map<string, LiveEvent[]> = new Map(),
): FundRun | null {
  const valid = predictions.filter((p) => assetBySymbol(p.symbol) && isDirection(p.direction));
  if (valid.length === 0) return null;
  const start = valid.reduce((m, p) => (p.made_on < m ? p.made_on : m), valid[0].made_on);
  const universe = [...new Set(valid.map((p) => p.symbol))];
  const book = { closes, instruments: instrumentsFor(universe) };

  // Dni i instrumenty, na których grali prawdziwi gracze — tam rzuca małpa.
  // Chwila rzutu = najwcześniejsza prognoza graczy na tym instrumencie i dniu.
  const sd = new Map<string, { symbol: string; day: string; at: string | null }>();
  for (const p of valid) {
    const key = `${p.symbol}|${p.made_on}`;
    const cur = sd.get(key);
    const at = p.made_at ?? null;
    if (!cur) sd.set(key, { symbol: p.symbol, day: p.made_on, at });
    else if (at && (!cur.at || at < cur.at)) cur.at = at;
  }
  const symbolDays = [...sd.values()];

  const signalsFor = (player: PlayerDef): FundSignal[] => {
    if (player.kind === "benchmark") return basketSignals(universe, start);
    if (player.kind === "monkey") return monkeySignals(symbolDays);
    const source = player.source ?? player.key;
    const horizon = player.horizonDays ?? 7;
    return valid
      .filter((p) => p.source === source && (p.horizon_days ?? 7) === horizon)
      .map(toSignal)
      .filter((s): s is FundSignal => s !== null);
  };

  return {
    start,
    end,
    players: PLAYERS.map((player) => {
      const signals = signalsFor(player);
      const result = simulate(signals, book, { start, end, events: events.get(player.key) });
      return {
        ...player,
        result,
        metrics: {
          ...computeMetrics(result.nav, result.trades, DEFAULT_RULES.startCashPln),
          financingPln: result.financingPln,
          exits: result.exits,
          horizonDays: player.horizonDays,
          pending: result.pending.length,
          signals: signals.length,
          lastSignalOn: signals.reduce<string | null>(
            (m, s) => (m === null || s.madeOn > m ? s.madeOn : m),
            null,
          ),
        },
      };
    }),
  };
}
