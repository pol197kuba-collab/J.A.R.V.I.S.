// DORADCA — kiedy i o czym wysłać push. Czysta logika.
//
// Dwa rodzaje meldunków:
// - NOWE ZAGRANIE: przy przeliczeniu (job 8:30 / 20:00), siła ≥ progu z
//   ustawień, jeden push na instrument i kierunek dziennie.
// - WYJŚCIE: tylko dla pozycji oznaczonych „zagrałem” w dzienniku. Przebieg
//   na żywo (co 15 min) sprawdza cenę: take-profit, stop-loss, koniec
//   horyzontu; a zgodność graczy po nowych prognozach — gdy obróciła się
//   przeciw pozycji, „AI radzi zamknąć”. Każdy rodzaj wyjścia raz na pozycję.
// Oba tylko w oknie godzin z ustawień (czas Warszawy).

import { GRADE_LABEL, type Consensus, type Play } from "./plan";

/** Godzina w Warszawie (0–23) i dzień YYYY-MM-DD. */
export function warsawClock(now: Date): { hour: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { hour: Number(get("hour")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

export function pushWindowOpen(now: Date, fromHour: number, toHour: number): boolean {
  const { hour } = warsawClock(now);
  return hour >= fromHour && hour < toHour;
}

export const playKey = (p: { symbol: string; side: string }, day: string): string =>
  `${day}|${p.symbol}|${p.side}`;

/** Zagrania, o których trzeba teraz powiadomić (bez tych już wysłanych dziś). */
export function playsToNotify(
  plays: Play[],
  minStrength: number,
  sentToday: ReadonlySet<string>,
  day: string,
): Play[] {
  return plays.filter((p) => p.strength >= minStrength && !sentToday.has(playKey(p, day)));
}

const sideWord = (side: "buy" | "sell") => (side === "buy" ? "KUP" : "SPRZEDAJ");

export function playMessage(p: Play, fmt: (v: number) => string): { title: string; body: string } {
  return {
    title: `${p.side === "buy" ? "▲" : "▼"} ${sideWord(p.side)} ${p.label} · siła ${p.strength} (${GRADE_LABEL[p.grade]})`,
    body: `XTB ${p.xtbName} · dźwignia 1:${p.leverage} · ${p.portfolioHint} · SL ${fmt(p.stop)} · TP ${fmt(p.take)} · do ${p.expiresOn}`,
  };
}

// ---------------------------------------------------------------- wyjścia ----

export type OpenPosition = {
  id: string;
  symbol: string;
  label: string;
  side: "buy" | "sell";
  entry: number;
  stop: number;
  take: number;
  expiresOn: string;
  /** Rodzaje wyjść, o których już powiadomiono. */
  alerts: string[];
};

export type ExitKind = "take" | "stop" | "expired" | "flip";

export type ExitAlert = {
  id: string;
  kind: ExitKind;
  title: string;
  body: string;
  /** Czy pozycja jest po tym meldunku zamknięta w dzienniku (TP/SL). */
  closes: boolean;
};

export function exitAlerts(
  positions: OpenPosition[],
  prices: ReadonlyMap<string, number>,
  consensusBySymbol: ReadonlyMap<string, Consensus>,
  day: string,
  fmt: (v: number) => string,
): ExitAlert[] {
  const out: ExitAlert[] = [];
  for (const p of positions) {
    const px = prices.get(p.symbol);
    const long = p.side === "buy";
    const done = new Set(p.alerts);
    if (px !== undefined && px > 0) {
      const pnlPct = ((px / p.entry - 1) * 100 * (long ? 1 : -1)).toFixed(1).replace(".", ",");
      const hitTake = long ? px >= p.take : px <= p.take;
      const hitStop = long ? px <= p.stop : px >= p.stop;
      if (hitTake && !done.has("take")) {
        out.push({
          id: p.id,
          kind: "take",
          closes: true,
          title: `✓ ${p.label}: take-profit osiągnięty`,
          body: `Cena ${fmt(px)} (${pnlPct}% od wejścia). Jeśli TP nie zadziałał w XTB — zamknij ręcznie.`,
        });
        continue;
      }
      if (hitStop && !done.has("stop")) {
        out.push({
          id: p.id,
          kind: "stop",
          closes: true,
          title: `✕ ${p.label}: stop-loss`,
          body: `Cena ${fmt(px)} (${pnlPct}% od wejścia). Jeśli SL nie zadziałał w XTB — zamknij ręcznie.`,
        });
        continue;
      }
    }
    const c = consensusBySymbol.get(p.symbol);
    const against =
      c && c.direction !== "flat" && (c.direction === "up") !== long && c.strength >= 30;
    if (against && !done.has("flip")) {
      out.push({
        id: p.id,
        kind: "flip",
        closes: false,
        title: `! ${p.label}: AI radzi zamknąć`,
        body: `Gracze obrócili się ${c.direction === "up" ? "na wzrost" : "na spadek"} (siła ${c.strength}, ${c.agree}/${c.total}). Proponuję zamknąć ${px ? `po ~${fmt(px)}` : "teraz"}.`,
      });
      continue;
    }
    if (day >= p.expiresOn && !done.has("expired")) {
      out.push({
        id: p.id,
        kind: "expired",
        closes: false,
        title: `⏱ ${p.label}: koniec horyzontu`,
        body: `Prognoza była na 2 dni — dziś jest termin zamknięcia${px ? ` (cena ${fmt(px)})` : ""}.`,
      });
    }
  }
  return out;
}
