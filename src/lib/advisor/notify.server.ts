// DORADCA — powiadomienia z jobów (plik serwerowy).
//
// notifyNewPlays: po przeliczeniu (scripts/markets-daily.ts, 8:30 / 20:00)
//   mocne zagrania → push, jeden na instrument i kierunek dziennie.
// watchPositions: przebieg na żywo (scripts/markets-live.ts, co 15 min)
//   pilnuje pozycji „zagrałem” z dziennika — TP / SL / koniec horyzontu /
//   gracze obróceni przeciw pozycji. Poza oknem godzin nic nie wysyła i nic
//   nie odhacza, więc meldunek przyjdzie, gdy okno się otworzy (jeśli
//   warunek nadal trwa).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { notifyOwner } from "@/lib/notifications/notify.server";
import { computeAdvice, currentConsensus, fmtPrice, loadAdvisorSettings } from "./advisor.server";
import {
  exitAlerts,
  playKey,
  playMessage,
  playsToNotify,
  pushWindowOpen,
  warsawClock,
  type OpenPosition,
} from "./alerts";

type Db = SupabaseClient<Database>;

const ADVISOR_URL = "/rynki?doradca=1";

export async function notifyNewPlays(
  db: Db,
  ownerId: string,
  now = new Date(),
): Promise<{ sent: number; candidates: number; windowClosed: boolean }> {
  const advice = await computeAdvice(db, ownerId, { now });
  const s = advice.settings;
  const { day } = warsawClock(now);
  if (!pushWindowOpen(now, s.pushFromHour, s.pushToHour)) {
    return { sent: 0, candidates: advice.plays.length, windowClosed: true };
  }
  const { data: sentRows } = await db
    .from("notifications")
    .select("payload")
    .eq("owner_id", ownerId)
    .eq("kind", "advisor_play")
    .gte("created_at", new Date(now.getTime() - 26 * 3_600_000).toISOString());
  const sent = new Set(
    (sentRows ?? []).flatMap((r) => {
      const p = r.payload as { key?: unknown } | null;
      return typeof p?.key === "string" ? [p.key] : [];
    }),
  );
  const todo = playsToNotify(advice.plays, s.pushMinStrength, sent, day);
  let count = 0;
  for (const p of todo) {
    const msg = playMessage(p, fmtPrice);
    const r = await notifyOwner(db, ownerId, {
      kind: "advisor_play",
      title: msg.title,
      body: msg.body,
      url: ADVISOR_URL,
      tag: `advisor-${p.symbol}`,
      payload: {
        key: playKey(p, day),
        symbol: p.symbol,
        side: p.side,
        strength: p.strength,
      } as Json,
    });
    if (r.id) count += 1;
  }
  return { sent: count, candidates: todo.length, windowClosed: false };
}

/** Symbole otwartych pozycji z dziennika — przebieg na żywo pobiera ich ceny. */
export async function openPositionSymbols(db: Db, ownerId: string): Promise<string[]> {
  const { data } = await db
    .from("advisor_journal")
    .select("symbol")
    .eq("owner_id", ownerId)
    .eq("action", "played")
    .eq("status", "open");
  return [...new Set((data ?? []).map((r) => r.symbol))];
}

export async function watchPositions(
  db: Db,
  ownerId: string,
  prices: ReadonlyMap<string, number>,
  now = new Date(),
): Promise<{ checked: number; sent: number; windowClosed: boolean }> {
  const { data, error } = await db
    .from("advisor_journal")
    .select("id, symbol, label, side, entry_price, stop_price, take_price, expires_on, alerts")
    .eq("owner_id", ownerId)
    .eq("action", "played")
    .eq("status", "open");
  if (error) throw new Error(`advisor_journal: ${error.message}`);
  const positions: OpenPosition[] = (data ?? []).map((r) => ({
    id: r.id,
    symbol: r.symbol,
    label: r.label,
    side: r.side === "buy" ? "buy" : "sell",
    entry: Number(r.entry_price),
    stop: Number(r.stop_price),
    take: Number(r.take_price),
    expiresOn: r.expires_on,
    alerts: r.alerts ?? [],
  }));
  if (positions.length === 0) return { checked: 0, sent: 0, windowClosed: false };

  const { settings } = await loadAdvisorSettings(db, ownerId);
  if (!pushWindowOpen(now, settings.pushFromHour, settings.pushToHour)) {
    return { checked: positions.length, sent: 0, windowClosed: true };
  }
  const { day } = warsawClock(now);
  const cons = await currentConsensus(db, ownerId, now.toISOString().slice(0, 10));
  const alerts = exitAlerts(positions, prices, cons, day, fmtPrice);
  let sent = 0;
  for (const a of alerts) {
    const pos = positions.find((p) => p.id === a.id)!;
    const r = await notifyOwner(db, ownerId, {
      kind: "advisor_exit",
      title: a.title,
      body: a.body,
      url: ADVISOR_URL,
      tag: `advisor-exit-${pos.symbol}`,
      payload: { journalId: a.id, kind: a.kind, symbol: pos.symbol } as Json,
    });
    if (!r.id) continue;
    sent += 1;
    await db
      .from("advisor_journal")
      .update({
        alerts: [...pos.alerts, a.kind],
        ...(a.closes
          ? {
              status: "closed",
              closed_reason: a.kind === "take" ? "take-profit" : "stop-loss",
              closed_at: now.toISOString(),
            }
          : {}),
      })
      .eq("id", a.id)
      .eq("owner_id", ownerId);
  }
  return { checked: positions.length, sent, windowClosed: false };
}
