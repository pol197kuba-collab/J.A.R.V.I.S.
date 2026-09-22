// PORANNY BRIEFING — składanie tekstu z faktów. Czysta funkcja: te same
// liczby na wejściu dają zawsze ten sam briefing, bez bazy i bez modelu.
//
// DLACZEGO TO NIE JEST ROBOTA MODELU. Model przepisuje ten tekst na ładniejszy
// (build.server.ts), ale nie jest do niego POTRZEBNY — i to jest celowa
// asymetria. Briefing, który istnieje tylko wtedy, gdy dostawca modelu
// odpowiedział, nie jest codzienną rubryką, tylko loterią; a rano nie ma
// komu zauważyć, że dziś akurat nie wyszło. Kiedy model jest dostępny,
// dostajemy lepszy język. Kiedy nie — dostajemy ten sam komplet informacji,
// tylko sucho.
//
// ZASADA NACZELNA: SEKCJA BEZ TREŚCI NIE ISTNIEJE. Briefing z sześcioma
// nagłówkami, z których cztery mówią „bez zmian", uczy przewijać go bez
// czytania — a wtedy nie zauważy się tego jednego dnia, w którym coś się
// wydarzyło. Lepiej, żeby spokojny dzień miał dwie linijki.
import { money, signedPct } from "@/lib/format/number";
import type { BriefFacts, BriefSection, ComposedBrief } from "./types";

/** Zwrot grzecznościowy — ten sam, którego używa reszta aplikacji. */
const GREETING = "Dzień dobry, Panie Sławiński.";

/** Ruch mniejszy niż to jest szumem sesji, nie wiadomością. */
const MOVER_FLOOR_PCT = 1.5;

/** Ile pozycji najwyżej w jednej sekcji — briefing ma się dać przeczytać. */
const MAX_PER_SECTION = 3;

/** Przekonanie poniżej tego progu nie zasługuje na zdanie w briefingu. */
const CALL_FLOOR_CONFIDENCE = 55;

const DIRECTION_WORD: Record<"up" | "down" | "flat", string> = {
  up: "wzrost",
  down: "spadek",
  flat: "bez kierunku",
};

/** „za 2 dni" / „wczoraj" — termin zadania po ludzku, nie w ISO. */
function dueLabel(dueAt: string | null, now: Date): string {
  if (!dueAt) return "bez terminu";
  const days = Math.round(
    (Date.parse(dueAt) - Date.parse(now.toISOString().slice(0, 10))) / 86_400_000,
  );
  if (days < -1) return `${Math.abs(days)} dni po terminie`;
  if (days === -1) return "dzień po terminie";
  if (days === 0) return "termin dziś";
  if (days === 1) return "termin jutro";
  return `termin za ${days} dni`;
}

function marketsSection(facts: BriefFacts): BriefSection | null {
  const movers = facts.movers
    .filter((m) => Math.abs(m.changePct) >= MOVER_FLOOR_PCT)
    .slice(0, MAX_PER_SECTION);
  if (movers.length === 0) return null;

  return {
    kind: "markets",
    heading: "Rynki",
    lines: movers.map(
      (m) => `${m.label}: ${signedPct(m.changePct)}, ${money(m.lastPrice)} ${m.currency}.`,
    ),
  };
}

function outlookSection(facts: BriefFacts): BriefSection | null {
  const calls = facts.calls
    .filter((c) => c.direction !== "flat" && c.confidence >= CALL_FLOOR_CONFIDENCE)
    .slice(0, MAX_PER_SECTION);

  const lines = calls.map(
    (c) => `${c.label}: ${DIRECTION_WORD[c.direction]}, przekonanie ${c.confidence} na 100.`,
  );

  // Skuteczność dopisujemy TYLKO obok prognoz. Sama, bez nich, brzmiałaby
  // jak ocena wystawiona bez podania, czego dotyczy.
  if (lines.length > 0 && facts.accuracy.hitRatePct !== null) {
    lines.push(
      `Dotychczasowa trafność: ${facts.accuracy.hitRatePct}% z ${facts.accuracy.settled} rozliczonych.`,
    );
  }

  if (lines.length === 0) return null;
  return { kind: "outlook", heading: "Typer", lines };
}

function fuelSection(facts: BriefFacts): BriefSection | null {
  const { fuel } = facts;
  if (!fuel) return null;
  // Cena sama w sobie nie jest wiadomością — jest nią dopiero zmiana. Bez
  // tygodniowego odniesienia sekcja tylko powtarza to, co widać w module.
  if (fuel.changeWeekPct === null || Math.abs(fuel.changeWeekPct) < 0.5) return null;

  return {
    kind: "fuel",
    heading: "Paliwa",
    lines: [
      `${fuel.label}: ${money(fuel.price)} ${fuel.unit}, ` +
        `${signedPct(fuel.changeWeekPct)} przez tydzień.`,
    ],
  };
}

function ordersSection(facts: BriefFacts): BriefSection | null {
  if (facts.firedOrders.length === 0) return null;
  return {
    kind: "orders",
    heading: "Rozkazy",
    lines: facts.firedOrders
      .slice(0, MAX_PER_SECTION)
      .map((o) => `Wyzwolił się: ${o.description}.`),
  };
}

function tasksSection(facts: BriefFacts): BriefSection | null {
  const lines: string[] = [];
  const now = new Date();

  for (const task of facts.tasks.overdue.slice(0, MAX_PER_SECTION)) {
    lines.push(`Po terminie: ${task.title} (${dueLabel(task.dueAt, now)}).`);
  }
  for (const task of facts.tasks.today.slice(0, MAX_PER_SECTION)) {
    lines.push(`Na dziś: ${task.title}.`);
  }

  const hiddenOverdue = Math.max(0, facts.tasks.overdue.length - MAX_PER_SECTION);
  if (hiddenOverdue > 0) lines.push(`…i ${hiddenOverdue} więcej po terminie.`);

  if (lines.length === 0) return null;
  return { kind: "tasks", heading: "Zadania", lines };
}

function failuresSection(facts: BriefFacts): BriefSection | null {
  if (facts.failures.count === 0) return null;
  const lines = [
    facts.failures.count === 1
      ? "Jedna awaria w ciągu doby."
      : `${facts.failures.count} awarii w ciągu doby.`,
  ];
  if (facts.failures.sample) lines.push(`Ostatnia: ${facts.failures.sample}`);
  return { kind: "failures", heading: "Usterki", lines };
}

/**
 * Wersja mówiona: jeden ciąg zdań, bez list i bez znaków, których synteza
 * mowy nie przeczyta sensownie.
 *
 * Powstaje z TYCH SAMYCH sekcji, nie z faktów na nowo — inaczej tekst na
 * ekranie i tekst w głośniku mogłyby z czasem powiedzieć co innego.
 */
function toSpoken(greeting: string, sections: BriefSection[]): string {
  if (sections.length === 0) {
    return `${greeting} Nic nie wymaga dziś uwagi.`;
  }
  const body = sections
    .map((section) => `${section.heading}. ${section.lines.join(" ")}`)
    .join(" ");
  return (
    `${greeting} ${body}`
      // Procent i myślnik czyta się źle; nawiasy gubią intonację.
      .replace(/%/g, " procent")
      .replace(/\u00a0/g, " ")
      .replace(/ — /g, ", ")
      .replace(/[()]/g, "")
  );
}

/** Składa briefing z faktów. Sekcje w kolejności ważności, nie alfabetycznie. */
export function composeBrief(facts: BriefFacts): ComposedBrief {
  const sections = [
    failuresSection(facts),
    ordersSection(facts),
    tasksSection(facts),
    marketsSection(facts),
    outlookSection(facts),
    fuelSection(facts),
  ].filter((s): s is BriefSection => s !== null);

  return { greeting: GREETING, sections, spoken: toSpoken(GREETING, sections) };
}
