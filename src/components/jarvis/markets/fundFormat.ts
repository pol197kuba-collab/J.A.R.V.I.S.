// Wspólne dla paneli funduszu: kolory graczy i formatowanie liczb po polsku.
//
// Kolory graczy: stałe sloty --market-1..5 w kolejności PLAYERS (paleta
// sprawdzona walidatorem dla sąsiednich par). Kolor niesie tożsamość gracza,
// a odniesienia (koszyk, małpa) dodatkowo rysowane są linią przerywaną —
// tożsamość nigdy nie zależy od samego koloru.

export const PLAYER_COLOR: Record<string, string> = {
  ai_learned: "var(--market-1)",
  ai: "var(--market-2)",
  signals: "var(--market-3)",
  basket: "var(--market-4)",
  monkey: "var(--market-5)",
};

/** Krótkie nazwy do nagłówków tabeli porównawczej. */
export const PLAYER_SHORT: Record<string, string> = {
  ai_learned: "AI+W",
  ai: "AI",
  signals: "Sygn.",
  basket: "Koszyk",
  monkey: "Małpa",
};

export const KIND_BADGE: Record<string, string | null> = {
  source: null,
  benchmark: "odniesienie",
  monkey: "losowy",
};

export const plnFmt = (v: number, digits = 0): string =>
  v.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sign = (v: number): string => (v > 0 ? "+" : v < 0 ? "−" : "");
export const pctFmt = (v: number, digits = 2): string =>
  `${sign(v)}${plnFmt(Math.abs(v), digits)}%`;
/** „+1 234 zł” / „−460 zł” — zero bez znaku. */
export const zlFmt = (v: number): string => `${sign(Math.round(v))}${plnFmt(Math.abs(v))} zł`;
/** Zwięźle do tabeli: −460, +1,5k. */
export const zlCompact = (v: number): string => {
  const a = Math.abs(v);
  if (Math.round(a) === 0) return "0";
  return a >= 1000 ? `${sign(v)}${plnFmt(a / 1000, 1)}k` : `${sign(v)}${plnFmt(a)}`;
};
export const signColor = (v: number): string =>
  Math.round(v) > 0
    ? "var(--success)"
    : Math.round(v) < 0
      ? "var(--destructive)"
      : "var(--muted-foreground)";
export const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
