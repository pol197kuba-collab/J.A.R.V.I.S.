// PORANNY BRIEFING — typy wspólne dla zbierania faktów, składania tekstu i
// interfejsu. Osobny plik, bo czyta je i kod serwera, i komponent React, a
// ani jeden nie ma powodu ciągnąć za sobą zależności drugiego.

/** Co system wie o świecie użytkownika na rano. Same liczby, zero prozy. */
export type BriefFacts = {
  /** Dzień, którego dotyczy briefing (ISO, YYYY-MM-DD). */
  date: string;

  /** Instrumenty z watchlisty, które ruszyły się najmocniej przez dobę. */
  movers: Array<{
    symbol: string;
    label: string;
    changePct: number;
    lastPrice: number;
    currency: string;
  }>;

  /** Najmocniejsze prognozy typera — te, o których w ogóle warto wspomnieć. */
  calls: Array<{
    symbol: string;
    label: string;
    direction: "up" | "down" | "flat";
    confidence: number;
  }>;

  /** Skuteczność rozliczonych prognoz; null, gdy nie ma jeszcze z czego liczyć. */
  accuracy: { settled: number; hitRatePct: number | null };

  /** Hurtowa cena paliwa referencyjnego. */
  fuel: {
    label: string;
    price: number;
    unit: string;
    changeWeekPct: number | null;
  } | null;

  /** Stałe rozkazy, które wyzwoliły się od wczoraj. */
  firedOrders: Array<{ description: string; firedAt: string }>;

  tasks: {
    overdue: Array<{ title: string; dueAt: string | null }>;
    today: Array<{ title: string }>;
  };

  /** Awarie zapisane w system_events przez ostatnią dobę. */
  failures: { count: number; sample: string | null };

  /** Stan miesięcznego budżetu na modele; null, gdy limit wyłączony. */
  budget: { spentUsd: number; limitUsd: number; message: string } | null;
};

export type BriefSectionKind =
  | "markets"
  | "outlook"
  | "fuel"
  | "orders"
  | "tasks"
  | "failures"
  | "budget";

export type BriefSection = {
  kind: BriefSectionKind;
  heading: string;
  /** Zdania do wypisania jedno pod drugim. Bez markdownu — to nie dokument. */
  lines: string[];
};

export type ComposedBrief = {
  greeting: string;
  sections: BriefSection[];
  /** Jeden akapit do odczytania na głos — bez list, skrótów i myślników. */
  spoken: string;
};

/** Briefing tak, jak leży w bazie i jak dostaje go interfejs. */
export type DailyBrief = ComposedBrief & {
  date: string;
  /** 'facts' = złożony z samych liczb, 'model:<nazwa>' = przepisany przez model. */
  generatedBy: string;
  createdAt: string;
};
