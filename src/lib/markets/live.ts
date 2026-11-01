// MARKET GRID NA ŻYWO — czysta logika przebiegu co 15 minut.
//
// Wejście: stan funduszu na teraz (czekające zlecenia i otwarte pozycje z
// progami ryzyka — engine.SimResult.pending/live) i bieżące ceny. Wyjście:
// zdarzenia do zapisania (realizacje, stop-lossy, take-profity) oraz
// kandydaci na alarm modelu. Zero tokenów — model woła dopiero alarm.
//
// Ceny starsze niż MAX_PRICE_AGE_MIN są pomijane: to zwykle zamknięta
// giełda, a jej ostatnia cena to zamknięcie, które silnik i tak już widział.

import type { LiveEvent, LivePosition, PendingOrder } from "@/lib/fund/engine";

export const MAX_PRICE_AGE_MIN = 30;
/** Alarm, gdy pozycja przeszła taką część drogi do stop-lossa. */
export const ALARM_STOP_SHARE = 0.6;
/** Gracze, których pozycjami może zarządzać alarm modelu. */
export const ALARM_PLAYERS = new Set(["ai", "ai_learned", "ai_7d"]);

export type LivePrice = { price: number; at: string; source: string };

export type PlayerState = { key: string; pending: PendingOrder[]; live: LivePosition[] };

export type PlayerEvent = LiveEvent & { player: string };

export type AlarmCandidate = {
  symbol: string;
  side: "long" | "short";
  price: number;
  at: string;
  /** Ruch od ceny odniesienia na korzyść pozycji (ujemny = strata), ułamek. */
  move: number;
  stop: number;
  refPx: number;
  reason: string | null;
  players: string[];
};

export function liveDecisions(
  players: PlayerState[],
  prices: Map<string, LivePrice>,
  now: Date,
): { events: PlayerEvent[]; alarms: AlarmCandidate[] } {
  const fresh = (p: LivePrice | undefined): p is LivePrice =>
    !!p && p.price > 0 && now.getTime() - Date.parse(p.at) <= MAX_PRICE_AGE_MIN * 60_000;
  const events: PlayerEvent[] = [];
  const alarms = new Map<string, AlarmCandidate>();

  for (const pl of players) {
    for (const o of pl.pending) {
      const px = prices.get(o.symbol);
      // Realizacja tylko po cenie zaobserwowanej PO postawieniu prognozy.
      if (!fresh(px) || !o.madeAt || px.at <= o.madeAt) continue;
      events.push({
        player: pl.key,
        kind: "fill",
        symbol: o.symbol,
        at: px.at,
        price: px.price,
        signalOn: o.madeOn,
      });
    }
    for (const l of pl.live) {
      const px = prices.get(l.symbol);
      if (!fresh(px)) continue;
      const move = (px.price / l.refPx - 1) * (l.side === "long" ? 1 : -1);
      const base = { player: pl.key, symbol: l.symbol, at: px.at, price: px.price, side: l.side };
      if (l.stop !== null && move <= -l.stop) {
        events.push({ ...base, kind: "stop" });
        continue;
      }
      if (l.take !== null && move >= l.take) {
        events.push({ ...base, kind: "take" });
        continue;
      }
      if (ALARM_PLAYERS.has(pl.key) && l.stop !== null && move <= -ALARM_STOP_SHARE * l.stop) {
        const key = `${l.symbol}|${l.side}`;
        const a = alarms.get(key);
        if (a) a.players.push(pl.key);
        else
          alarms.set(key, {
            symbol: l.symbol,
            side: l.side,
            price: px.price,
            at: px.at,
            move,
            stop: l.stop,
            refPx: l.refPx,
            reason: l.reason,
            players: [pl.key],
          });
      }
    }
  }
  return { events, alarms: [...alarms.values()] };
}

/** Odpowiedź modelu w alarmie → decyzja; wszystko inne niż wyraźne „close” = trzymaj. */
export function parseAlarmReply(text: string | null): {
  action: "hold" | "close";
  reasonPl: string | null;
} {
  if (!text) return { action: "hold", reasonPl: null };
  const m = /\{[\s\S]*\}/.exec(text);
  try {
    const raw = JSON.parse(m ? m[0] : text) as { action?: unknown; reason_pl?: unknown };
    const action = raw.action === "close" ? "close" : "hold";
    const reasonPl =
      typeof raw.reason_pl === "string" && raw.reason_pl.trim()
        ? raw.reason_pl.trim().slice(0, 240)
        : null;
    return { action, reasonPl };
  } catch {
    return { action: "hold", reasonPl: null };
  }
}
