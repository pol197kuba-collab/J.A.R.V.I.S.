// Agent Town — the paper fund (PLAN.md, S3.3) as the trading floor sees it.
// Pure: FundView in, everything the Parkiet draws and says out. Every number
// here comes from the real fund (src/lib/fund) — nothing is invented.
//
// M.E.T.R.I.C. is the floor's trader: its mood follows yesterday's average
// change of the forecast-driven players (AI, AI z wnioskami, Sygnały) —
// hunched after a loss, upbeat after a gain.

import type { FundView } from "@/lib/fund/fund.functions";
import { isWaiting } from "@/lib/fund/verdict";

/** Short tags that fit the 3×5 pixel font of the boards. */
export const FUND_TAG: Record<string, string> = {
  ai_learned: "AI+",
  ai: "AI",
  signals: "SYGN",
  basket: "KOSZ",
  monkey: "MALPA",
};

/** Player colors on the floor's screens — artwork, like the rest of townArt. */
export const FUND_COLOR: Record<string, string> = {
  ai_learned: "#4fd8f0",
  ai: "#ff6fb5",
  signals: "#57d98a",
  basket: "#7aa7ff",
  monkey: "#ffd34d",
};

export type TownFundPlayer = {
  key: string;
  label: string;
  tag: string;
  kind: string;
  returnPct: number;
  /** Change of the last day's valuation, %; null with < 2 days of history. */
  dayPct: number | null;
  navPln: number;
  /** No forecast yet (e.g. AI+ without lessons) — not playing, ranked last. */
  waiting: boolean;
};

export type TownMood = "up" | "down" | "flat";

export type TownFund = {
  /** Ranked by return since start, best first. */
  players: TownFundPlayer[];
  /** Average last-day change of the forecast-driven players, %. */
  dayAvg: number | null;
  mood: TownMood;
  statue: "bull" | "bear" | "calm";
  /** Valuation series per player (oldest → newest), for the big screen. */
  curves: Record<string, number[]>;
  /** Biggest positions of the leading forecast player, P/L in %. */
  heat: { symbol: string; plPct: number }[];
  /** LED ticker items, already safe for the pixel font. */
  ticker: { text: string; sign: -1 | 0 | 1 }[];
  days: number;
  computedAt: string | null;
};

/** A day move under this many % is noise — M.E.T.R.I.C. keeps a straight face. */
export const MOOD_BAND = 0.2;
/** The statue flips between bull and bear above this move, %. */
export const STATUE_BAND = 0.05;
/** How many days the big screen shows. */
export const CURVE_DAYS = 60;

const SOURCE_KINDS = new Set(["source"]);

const PL: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/** Upper-case ASCII the 3×5 font can draw (Polish letters folded). */
export function pixelSafe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL[c] ?? c)
    .toUpperCase()
    .replace(/[^A-Z0-9 +\-%.,:/▲▼]/g, "");
}

/** „+2,83%” in the board's style (comma, explicit sign). */
export function pctLabel(v: number, digits = 2): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(digits).replace(".", ",")}%`;
}

const signOf = (v: number): -1 | 0 | 1 => (v > 0.005 ? 1 : v < -0.005 ? -1 : 0);

export function moodOf(dayAvg: number | null): TownMood {
  if (dayAvg === null) return "flat";
  return dayAvg <= -MOOD_BAND ? "down" : dayAvg >= MOOD_BAND ? "up" : "flat";
}

export function townFund(view: FundView | null | undefined): TownFund | null {
  if (!view || view.players.length === 0) return null;
  const nav = view.nav;
  const last = nav[nav.length - 1];
  const prev = nav[nav.length - 2];

  const players: TownFundPlayer[] = view.players
    .map((p) => {
      const a = prev ? Number(prev[p.key]) : NaN;
      const b = last ? Number(last[p.key]) : NaN;
      const dayPct = Number.isFinite(a) && Number.isFinite(b) && a > 0 ? (b / a - 1) * 100 : null;
      return {
        key: p.key,
        label: p.label,
        tag: FUND_TAG[p.key] ?? pixelSafe(p.label).slice(0, 5),
        kind: p.kind,
        returnPct: p.metrics?.returnPct ?? 0,
        dayPct,
        navPln: p.navPln,
        waiting: isWaiting(p),
      };
    })
    .sort((x, y) => Number(x.waiting) - Number(y.waiting) || y.returnPct - x.returnPct);

  const sourceDays = players
    .filter((p) => SOURCE_KINDS.has(p.kind) && !p.waiting && p.dayPct !== null)
    .map((p) => p.dayPct as number);
  const dayAvg =
    sourceDays.length > 0 ? sourceDays.reduce((s, v) => s + v, 0) / sourceDays.length : null;

  const curves: Record<string, number[]> = {};
  const window = nav.slice(-CURVE_DAYS);
  for (const p of players) {
    curves[p.key] = window.map((r) => Number(r[p.key])).filter((v) => Number.isFinite(v));
  }

  const leader = players.find((p) => SOURCE_KINDS.has(p.kind)) ?? players[0];
  const heat = (view.positions[leader.key] ?? [])
    .filter((pos) => pos.costPln > 0)
    .slice(0, 8)
    .map((pos) => ({ symbol: pos.symbol, plPct: (pos.valuePln / pos.costPln - 1) * 100 }));

  const ticker: TownFund["ticker"] = [{ text: "FUNDUSZ J.A.R.V.I.S.", sign: 0 }];
  for (const p of players.filter((x) => !x.waiting)) {
    ticker.push({ text: `${p.tag} ${pctLabel(p.returnPct)}`, sign: signOf(p.returnPct) });
    if (p.dayPct !== null) {
      ticker.push({ text: `${p.tag} DZIS ${pctLabel(p.dayPct)}`, sign: signOf(p.dayPct) });
    }
  }
  for (const h of heat) {
    ticker.push({
      text: `${pixelSafe(h.symbol.replace(/\.(PL|US)$/, ""))} ${pctLabel(h.plPct, 1)}`,
      sign: signOf(h.plPct),
    });
  }

  return {
    players,
    dayAvg,
    mood: moodOf(dayAvg),
    statue:
      dayAvg === null
        ? "calm"
        : dayAvg >= STATUE_BAND
          ? "bull"
          : dayAvg <= -STATUE_BAND
            ? "bear"
            : "calm",
    curves,
    heat,
    ticker: ticker.map((t) => ({ ...t, text: pixelSafe(t.text) })),
    days: nav.length,
    computedAt: view.computedAt,
  };
}

/** What M.E.T.R.I.C. says on the trading floor — real numbers only. */
export function metricFloorLine(fund: TownFund): string {
  if (fund.dayAvg === null) return "Fundusz dopiero startuje.";
  const day = pctLabel(fund.dayAvg);
  if (fund.mood === "down") return `Wczoraj ${day}… boli.`;
  if (fund.mood === "up") return `Wczoraj ${day}! Tak trzymać.`;
  return `Wczoraj ${day}. Spokojnie.`;
}

/** Share of M.E.T.R.I.C.'s idle strolls that end on the trading floor. */
export const EXCHANGE_TRIP_CHANCE = 0.5;

// ── what the floor's props say (walk mode) — real numbers only ─────────────

const plPct = (v: number, digits = 2) => pctLabel(v, digits);

/** The ranking flip-board: top of the table and the verdict lines. */
export function rankingText(fund: TownFund | null, verdict: readonly string[]): string {
  if (!fund) return "Tablica jest pusta — fundusz nie był jeszcze przeliczony.";
  const top = fund.players
    .filter((p) => !p.waiting)
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.label} ${plPct(p.returnPct)}`)
    .join("\n");
  return [top, ...verdict.slice(0, 2)].join("\n");
}

/** The statue: bull, bear or calm, and the day that decided it. */
export function statueText(fund: TownFund | null): string {
  if (!fund || fund.dayAvg === null)
    return "Posąg czeka na pierwszy pełny dzień funduszu — jeszcze nie wie, kim być.";
  const day = plPct(fund.dayAvg);
  if (fund.statue === "bull")
    return `Złoty byk szarżuje: wczoraj gracze-prognozy zarobili średnio ${day}.`;
  if (fund.statue === "bear")
    return `Brązowy niedźwiedź: wczoraj gracze-prognozy stracili średnio ${day}.`;
  return `Byk drzemie: wczoraj ${day}, czyli prawie bez ruchu.`;
}

/** A trader's terminal: the player's latest trades with their reasons. */
export function terminalText(
  label: string,
  orders: readonly {
    executedOn: string;
    side: "buy" | "sell";
    symbol: string;
    notionalPln: number;
    reason: string | null;
  }[],
): string {
  if (orders.length === 0) return `${label}: brak transakcji.`;
  return orders
    .slice(0, 3)
    .map(
      (o) =>
        `${o.executedOn} ${o.side === "buy" ? "kupno" : "sprzedaż"} ${o.symbol} za ${Math.round(o.notionalPln).toLocaleString("pl-PL")} zł` +
        (o.reason ? ` — ${o.reason.length > 90 ? `${o.reason.slice(0, 90)}…` : o.reason}` : ""),
    )
    .join("\n");
}
