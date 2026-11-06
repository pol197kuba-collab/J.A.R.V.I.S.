// FUNDUSZ — ustawienia gry. Czysta logika.
//
// Proste pokrętła dla człowieka (agresywność, dźwignia, krótka sprzedaż,
// stopy, częstotliwość pilnowania pozycji, dzień startu) tłumaczone na reguły
// silnika (engine.ts: FundRules). Wspólne dla całego funduszu, z możliwością
// nadpisania dla graczy AI. Gracze odniesienia (koszyk, małpa) grają ZAWSZE
// na regułach domyślnych — inaczej porównanie z nimi przestałoby cokolwiek
// mówić. Zmiana ustawień = przeliczenie całej gry od dnia startu.

import { DEFAULT_RULES, type FundRules } from "./engine";
import type { PlayerKind } from "./players";

/** 1 = ostrożnie … 5 = agresywnie. */
export type Aggressiveness = 1 | 2 | 3 | 4 | 5;
export const LEVERAGE_OPTIONS = [1, 1.5, 2, 3] as const;
export type Leverage = (typeof LEVERAGE_OPTIONS)[number];
/** Co ile minut przebieg „na żywo” pilnuje pozycji; 0 = wyłączony. */
export const LIVE_OPTIONS = [0, 15, 30, 60] as const;
export type LiveEvery = (typeof LIVE_OPTIONS)[number];

export type PlayerSettings = {
  aggressiveness: Aggressiveness;
  leverage: Leverage;
  allowShort: boolean;
  /** Stop-loss i take-profit (zależne od zmienności). */
  riskExits: boolean;
};

/** Gracze, którym wolno nadpisać ustawienia wspólne (prognozy AI). */
export const AI_PLAYERS = ["ai_learned", "ai", "ai_7d"] as const;
export type AiPlayer = (typeof AI_PLAYERS)[number];

export type FundSettings = {
  /** Dzień startu gry (YYYY-MM-DD): wcześniejsze prognozy nie grają. */
  startOn: string;
  global: PlayerSettings;
  overrides: Partial<Record<AiPlayer, PlayerSettings>>;
  liveEveryMin: LiveEvery;
};

/** 31.10.2026 — od tego dnia gra „AI z wnioskami”. */
export const DEFAULT_START_ON = "2026-10-31";

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  aggressiveness: 3,
  leverage: 2,
  allowShort: true,
  riskExits: true,
};

export const DEFAULT_FUND_SETTINGS: FundSettings = {
  startOn: DEFAULT_START_ON,
  global: DEFAULT_PLAYER_SETTINGS,
  overrides: {},
  liveEveryMin: 15,
};

// Poziom 3 = dokładnie DEFAULT_RULES (gra sprzed ustawień się nie zmienia).
const MAX_WEIGHT = [0.08, 0.13, 0.2, 0.27, 0.35];
const STOP_SIGMA = [0.8, 0.9, 1, 1.15, 1.3];
const TAKE_SIGMA = [1.2, 1.35, 1.5, 1.75, 2];
const LEVER_FROM = [0.75, 0.68, 0.6, 0.55, 0.5];

/** Reguły silnika dla jednego zestawu pokręteł. */
export function rulesFromSettings(s: PlayerSettings): Partial<FundRules> {
  const i = s.aggressiveness - 1;
  return {
    maxWeight: MAX_WEIGHT[i],
    maxLeverage: s.leverage,
    leverageFromConfidence: LEVER_FROM[i],
    allowShort: s.allowShort,
    stopSigma: s.riskExits ? STOP_SIGMA[i] : null,
    takeSigma: s.riskExits ? TAKE_SIGMA[i] : null,
  };
}

/** Ustawienia, na których gra dany gracz (wspólne albo jego własne). */
export function settingsFor(settings: FundSettings, playerKey: string): PlayerSettings {
  return (
    (settings.overrides as Record<string, PlayerSettings | undefined>)[playerKey] ?? settings.global
  );
}

/**
 * Reguły dla gracza. Koszyk i małpa: zawsze domyślne. Pozostali: wspólne
 * ustawienia, a gracze AI — ich własne, jeśli je mają.
 */
export function rulesForPlayer(
  settings: FundSettings,
  player: { key: string; kind: PlayerKind },
): Partial<FundRules> {
  if (player.kind !== "source") return {};
  return rulesFromSettings(settingsFor(settings, player.key));
}

// ---------------------------------------------------------- walidacja ----

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function parsePlayer(v: unknown, fallback: PlayerSettings): PlayerSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const a = Number(o.aggressiveness);
  const l = Number(o.leverage);
  return {
    aggressiveness: (Number.isInteger(a) && a >= 1 && a <= 5
      ? a
      : fallback.aggressiveness) as Aggressiveness,
    leverage: ((LEVERAGE_OPTIONS as readonly number[]).includes(l)
      ? l
      : fallback.leverage) as Leverage,
    allowShort: typeof o.allowShort === "boolean" ? o.allowShort : fallback.allowShort,
    riskExits: typeof o.riskExits === "boolean" ? o.riskExits : fallback.riskExits,
  };
}

/** Ustawienia z bazy (dowolny JSON) → poprawne ustawienia; braki = domyślne. */
export function parseFundSettings(raw: unknown): FundSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const global = parsePlayer(o.global, DEFAULT_PLAYER_SETTINGS);
  const rawOverrides = (
    o.overrides && typeof o.overrides === "object" ? o.overrides : {}
  ) as Record<string, unknown>;
  const overrides: FundSettings["overrides"] = {};
  for (const key of AI_PLAYERS) {
    if (rawOverrides[key]) overrides[key] = parsePlayer(rawOverrides[key], global);
  }
  const live = Number(o.liveEveryMin);
  return {
    startOn: isDate(o.startOn) ? o.startOn : DEFAULT_START_ON,
    global,
    overrides,
    liveEveryMin: ((LIVE_OPTIONS as readonly number[]).includes(live)
      ? live
      : DEFAULT_FUND_SETTINGS.liveEveryMin) as LiveEvery,
  };
}

// --------------------------------------------------------- dla ludzi ----

export const AGGRESSIVENESS_LABEL: Readonly<Record<Aggressiveness, string>> = {
  1: "Bardzo ostrożnie",
  2: "Ostrożnie",
  3: "Umiarkowanie",
  4: "Odważnie",
  5: "Agresywnie",
};

/** Co pokrętła znaczą w praktyce — jedna linia pod suwakiem. */
export function describeSettings(s: PlayerSettings): string {
  const r = rulesFromSettings(s);
  const parts = [
    `do ${Math.round((r.maxWeight ?? DEFAULT_RULES.maxWeight) * 100)}% portfela w jednej pozycji`,
    s.leverage <= 1 ? "bez dźwigni" : `dźwignia do ${String(s.leverage).replace(".", ",")}×`,
    s.allowShort ? "gra też na spadki" : "tylko zakupy",
    s.riskExits ? "z stop-lossem i take-profitem" : "bez automatycznych stopów",
  ];
  return parts.join(" · ");
}

/** Przebieg „na żywo” powinien teraz działać? (ostatni start, teraz, ustawienie) */
export function liveRunDue(lastRunAt: string | null, now: Date, everyMin: LiveEvery): boolean {
  if (everyMin === 0) return false;
  if (!lastRunAt) return true;
  const elapsedMin = (now.getTime() - Date.parse(lastRunAt)) / 60_000;
  // 2 minuty luzu: cron co 15 min nie trafia co do sekundy
  return elapsedMin >= everyMin - 2;
}
