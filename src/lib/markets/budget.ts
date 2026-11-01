// MARKET GRID — dzienny budżet tokenów modelu. Czysta logika + cienki
// adapter do bazy (createModelBudget).
//
// 20 000 tokenów na dobę (czas warszawski) na WSZYSTKO, co moduł rynkowy
// robi modelem. Podział, żeby jedna rzecz nie zjadła reszty:
// - prognozy (ai + ai_learned, oba horyzonty w jednym wywołaniu) — rdzeń,
// - ocena newsów — miła, ale ma tani zamiennik (heurystyka),
// - alarmy w ciągu dnia — rezerwa na granie na żywo.
// Przed wywołaniem kod szacuje koszt i sprawdza limit; po wywołaniu zapisuje
// faktyczne zużycie (Claude je zwraca, Gemini — szacunek z długości tekstu).
// Brak budżetu = model nie jest wołany, działa sama arytmetyka. Nigdy nie
// przekraczamy limitu „na kredyt”.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type BudgetPurpose = "forecast" | "forecast_learned" | "news" | "alarm";

export const DAILY_TOKEN_BUDGET = 20_000;

/** Pułapy per cel (sumują się do więcej niż budżet — wspólny limit i tak obowiązuje). */
export const PURPOSE_CAP: Record<BudgetPurpose, number> = {
  forecast: 7_000,
  forecast_learned: 7_000,
  news: 4_000,
  alarm: 4_000,
};

/** ~3,5 znaku na token dla polsko-angielskiego tekstu z liczbami — z zapasem. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5);

/** Dzień w Warszawie (YYYY-MM-DD) — doba budżetu. */
export function warsawDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type UsageRow = { purpose: string; tokens_in: number; tokens_out: number };

export type BudgetState = {
  day: string;
  used: number;
  limit: number;
  byPurpose: Record<BudgetPurpose, number>;
};

export function budgetState(rows: UsageRow[], day: string): BudgetState {
  const byPurpose: Record<BudgetPurpose, number> = {
    forecast: 0,
    forecast_learned: 0,
    news: 0,
    alarm: 0,
  };
  let used = 0;
  for (const r of rows) {
    const t = (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
    used += t;
    if (r.purpose in byPurpose) byPurpose[r.purpose as BudgetPurpose] += t;
  }
  return { day, used, limit: DAILY_TOKEN_BUDGET, byPurpose };
}

/** null = wolno; tekst = dlaczego nie (do logu). */
export function denyReason(
  state: BudgetState,
  purpose: BudgetPurpose,
  estimate: number,
): string | null {
  if (state.used + estimate > state.limit) {
    return `budżet dzienny: zużyte ${state.used} z ${state.limit} tokenów, potrzeba ~${estimate}`;
  }
  if (state.byPurpose[purpose] + estimate > PURPOSE_CAP[purpose]) {
    return `pułap „${purpose}”: zużyte ${state.byPurpose[purpose]} z ${PURPOSE_CAP[purpose]}, potrzeba ~${estimate}`;
  }
  return null;
}

/** Strażnik budżetu przekazywany do kodu, który woła model. */
export type ModelBudget = {
  /** null = można wołać; tekst = powód odmowy. */
  check(purpose: BudgetPurpose, estimate: number): Promise<string | null>;
  record(
    purpose: BudgetPurpose,
    usage: { model: string | null; tokensIn: number; tokensOut: number; estimated: boolean },
  ): Promise<void>;
};

/** Bez limitu — testy i miejsca bez bazy. */
export const UNLIMITED_BUDGET: ModelBudget = {
  check: async () => null,
  record: async () => {},
};

export function createModelBudget(
  db: SupabaseClient<Database>,
  ownerId: string,
  now: () => Date = () => new Date(),
): ModelBudget {
  const load = async (): Promise<BudgetState> => {
    const day = warsawDay(now());
    const { data, error } = await db
      .from("market_model_usage")
      .select("purpose, tokens_in, tokens_out")
      .eq("owner_id", ownerId)
      .eq("used_on", day);
    // Błąd odczytu = traktuj jak wyczerpany budżet: lepiej nie zawołać modelu
    // raz za dużo niż przepalić tokeny bez kontroli.
    if (error)
      return {
        day,
        used: DAILY_TOKEN_BUDGET,
        limit: DAILY_TOKEN_BUDGET,
        byPurpose: budgetState([], day).byPurpose,
      };
    return budgetState(data ?? [], day);
  };
  return {
    async check(purpose, estimate) {
      return denyReason(await load(), purpose, estimate);
    },
    async record(purpose, u) {
      const at = now();
      await db.from("market_model_usage").insert({
        owner_id: ownerId,
        used_at: at.toISOString(),
        used_on: warsawDay(at),
        purpose,
        model: u.model,
        tokens_in: Math.max(0, Math.round(u.tokensIn)),
        tokens_out: Math.max(0, Math.round(u.tokensOut)),
        estimated: u.estimated,
      });
    },
  };
}
