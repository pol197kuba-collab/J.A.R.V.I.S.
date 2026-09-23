import { describe, expect, it } from "vitest";
import { composeBrief } from "./compose";
import type { BriefFacts } from "./types";

/** Świat, w którym nic się nie dzieje — testy dokładają tylko to, co badają. */
const quiet: BriefFacts = {
  date: "2026-09-23",
  movers: [],
  calls: [],
  accuracy: { settled: 0, hitRatePct: null },
  fuel: null,
  firedOrders: [],
  tasks: { overdue: [], today: [] },
  failures: { count: 0, sample: null },
  budget: null,
};

const facts = (patch: Partial<BriefFacts>): BriefFacts => ({ ...quiet, ...patch });

const kinds = (f: BriefFacts) => composeBrief(f).sections.map((s) => s.kind);

describe("composeBrief — sekcja bez treści nie istnieje", () => {
  it("spokojny dzień to dwie linijki, nie sześć pustych nagłówków", () => {
    const brief = composeBrief(quiet);
    expect(brief.sections).toEqual([]);
    expect(brief.spoken).toContain("Nic nie wymaga dziś uwagi");
  });

  it("pomija ruch, który jest szumem sesji", () => {
    const noise = facts({
      movers: [
        { symbol: "BTC", label: "Bitcoin", changePct: 0.4, lastPrice: 98_000, currency: "USD" },
      ],
    });
    expect(kinds(noise)).not.toContain("markets");
  });

  it("melduje ruch, który jest wiadomością", () => {
    const real = facts({
      movers: [
        { symbol: "BTC", label: "Bitcoin", changePct: -6.2, lastPrice: 91_500, currency: "USD" },
      ],
    });
    const brief = composeBrief(real);
    expect(brief.sections[0].kind).toBe("markets");
    expect(brief.sections[0].lines[0]).toContain("-6,2%");
  });

  it("milczy o paliwie, które stoi w miejscu", () => {
    const flat = facts({
      fuel: { label: "ON Ekodiesel", price: 5200, unit: "PLN/m³", changeWeekPct: 0.1 },
    });
    expect(kinds(flat)).not.toContain("fuel");
  });

  it("nie zgaduje zmiany paliwa, gdy nie ma z czym porównać", () => {
    const noHistory = facts({
      fuel: { label: "ON Ekodiesel", price: 5200, unit: "PLN/m³", changeWeekPct: null },
    });
    expect(kinds(noHistory)).not.toContain("fuel");
  });
});

describe("composeBrief — typer", () => {
  it("pomija prognozy bez kierunku i bez przekonania", () => {
    const weak = facts({
      calls: [
        { symbol: "BTC", label: "Bitcoin", direction: "flat", confidence: 90 },
        { symbol: "ETH", label: "Ethereum", direction: "up", confidence: 30 },
      ],
    });
    expect(kinds(weak)).not.toContain("outlook");
  });

  it("dopisuje trafność TYLKO obok prognoz, nigdy samej", () => {
    // Ocena wystawiona bez podania, czego dotyczy, brzmi jak wyrok.
    const alone = facts({ accuracy: { settled: 40, hitRatePct: 62 } });
    expect(kinds(alone)).not.toContain("outlook");

    const withCalls = facts({
      calls: [{ symbol: "BTC", label: "Bitcoin", direction: "up", confidence: 70 }],
      accuracy: { settled: 40, hitRatePct: 62 },
    });
    const outlook = composeBrief(withCalls).sections.find((s) => s.kind === "outlook")!;
    expect(outlook.lines.at(-1)).toContain("62%");
    expect(outlook.lines.at(-1)).toContain("40");
  });
});

describe("composeBrief — kolejność i objętość", () => {
  it("stawia usterki i rozkazy przed notowaniami", () => {
    // Briefing czyta się od góry i często tylko od góry. To, co wymaga
    // decyzji, musi być wyżej niż to, co jest ciekawostką.
    const busy = facts({
      failures: { count: 2, sample: "market-grid: notowania BTC" },
      firedOrders: [{ description: "Bitcoin w dół o 5%", firedAt: "2026-09-23T04:00:00Z" }],
      movers: [
        { symbol: "BTC", label: "Bitcoin", changePct: -6, lastPrice: 91_000, currency: "USD" },
      ],
      tasks: { overdue: [{ title: "Raport", dueAt: "2026-09-20" }], today: [] },
    });
    expect(kinds(busy)).toEqual(["failures", "orders", "tasks", "markets"]);
  });

  it("nie wypisuje dziesięciu zadań, tylko mówi, ile ich zostało", () => {
    const many = facts({
      tasks: {
        overdue: Array.from({ length: 7 }, (_, i) => ({ title: `Zadanie ${i}`, dueAt: null })),
        today: [],
      },
    });
    const tasks = composeBrief(many).sections.find((s) => s.kind === "tasks")!;
    expect(tasks.lines).toHaveLength(4);
    expect(tasks.lines.at(-1)).toContain("4 więcej");
  });
});

describe("composeBrief — budżet", () => {
  it("milczy, dopóki budżet jest w normie", () => {
    // Codzienne „zużyto 12% limitu" nauczyłoby przewijać całą rubrykę.
    expect(kinds(quiet)).not.toContain("budget");
  });

  it("stawia budżet PRZED usterkami", () => {
    // Wyczerpany limit zmienia zachowanie wszystkich agentów na resztę
    // miesiąca — to więcej niż pojedyncza awaria.
    const busy = facts({
      budget: { spentUsd: 6, limitUsd: 5, message: "Limit miesięczny wyczerpany." },
      failures: { count: 1, sample: "market-grid" },
    });
    expect(kinds(busy)).toEqual(["budget", "failures"]);
  });
});

describe("composeBrief — wersja mówiona", () => {
  it("powstaje z tych samych sekcji co tekst na ekranie", () => {
    const brief = composeBrief(
      facts({
        failures: { count: 1, sample: "orlen-prices: fetch failed" },
        movers: [
          { symbol: "BTC", label: "Bitcoin", changePct: -6, lastPrice: 91_000, currency: "USD" },
        ],
      }),
    );
    for (const section of brief.sections) {
      expect(brief.spoken).toContain(section.heading);
    }
  });

  it("nie zostawia znaków, których synteza mowy nie przeczyta", () => {
    const brief = composeBrief(
      facts({
        movers: [
          { symbol: "BTC", label: "Bitcoin", changePct: -6.2, lastPrice: 91_500, currency: "USD" },
        ],
        tasks: { overdue: [{ title: "Raport", dueAt: "2026-09-20" }], today: [] },
      }),
    );
    expect(brief.spoken).not.toMatch(/[%()\u00a0]/);
    expect(brief.spoken).toContain("procent");
  });
});
