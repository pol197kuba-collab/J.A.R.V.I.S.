import { describe, expect, it } from "vitest";
import {
  formatCell,
  isPreviewableType,
  isSecretColumn,
  layoutSchema,
  planetRadius,
  SENSITIVE_TABLES,
  tableModule,
} from "./structure";

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("tableModule", () => {
  it("przypisuje tabele do modułów aplikacji", () => {
    expect(tableModule("notes")).toBe("wiedza");
    expect(tableModule("brain_points")).toBe("wiedza");
    expect(tableModule("market_quotes")).toBe("rynki");
    expect(tableModule("orlen_fuel_prices")).toBe("paliwa");
    expect(tableModule("fuel_news_items")).toBe("paliwa");
    expect(tableModule("agent_runs")).toBe("agenci");
    expect(tableModule("tasks")).toBe("praca");
    expect(tableModule("user_settings")).toBe("system");
    expect(tableModule("cos_nowego")).toBe("system");
  });
});

describe("ochrona sekretów", () => {
  it("tabele z kluczami nie mają podglądu danych", () => {
    expect(SENSITIVE_TABLES.has("user_secrets")).toBe(true);
    expect(SENSITIVE_TABLES.has("push_subscriptions")).toBe(true);
    expect(SENSITIVE_TABLES.has("notes")).toBe(false);
  });

  it("kolumny wyglądające na sekret są zakrywane", () => {
    for (const c of [
      "gemini_api_key",
      "github_token",
      "vapid_private_key",
      "client_secret",
      "apikey",
      "token",
    ]) {
      expect(isSecretColumn(c)).toBe(true);
    }
    for (const c of ["title", "body", "input_tokens", "cache_read_tokens", "tokenizer"]) {
      expect(isSecretColumn(c)).toBe(false);
    }
  });

  it("wektory i binaria nie trafiają do podglądu", () => {
    expect(isPreviewableType("extensions.vector(768)")).toBe(false);
    expect(isPreviewableType("vector(768)")).toBe(false);
    expect(isPreviewableType("bytea")).toBe(false);
    expect(isPreviewableType("text")).toBe(true);
    expect(isPreviewableType("jsonb")).toBe(true);
  });
});

describe("formatCell", () => {
  it("czytelny tekst, przycięty", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(3)).toBe("3");
    expect(formatCell(false)).toBe("false");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell("x".repeat(200))).toHaveLength(141);
  });
});

describe("planety", () => {
  it("rozmiar rośnie z liczbą wierszy, ale łagodnie", () => {
    expect(planetRadius(-1)).toBeCloseTo(planetRadius(0));
    expect(planetRadius(1000)).toBeGreaterThan(planetRadius(10));
    expect(planetRadius(10_000_000)).toBeLessThanOrEqual(0.68);
  });

  it("układ: deterministyczny, powiązane tabele bliżej niż średnio", () => {
    const tables = [
      { name: "agents", module: "agenci" as const },
      { name: "agent_runs", module: "agenci" as const },
      { name: "messages", module: "agenci" as const },
      { name: "conversations", module: "agenci" as const },
      { name: "notes", module: "wiedza" as const },
      { name: "memories", module: "wiedza" as const },
      { name: "market_quotes", module: "rynki" as const },
      { name: "market_predictions", module: "rynki" as const },
    ];
    const edges = [
      { from: "agent_runs", to: "agents" },
      { from: "messages", to: "conversations" },
      { from: "market_predictions", to: "market_quotes" },
    ];
    const a = layoutSchema(tables, edges);
    expect(layoutSchema(tables, edges)).toEqual(a);
    const linked = edges.map((e) => dist(a.get(e.from)!, a.get(e.to)!));
    const all: number[] = [];
    for (let i = 0; i < tables.length; i++)
      for (let j = i + 1; j < tables.length; j++)
        all.push(dist(a.get(tables[i].name)!, a.get(tables[j].name)!));
    const avgAll = all.reduce((s, x) => s + x, 0) / all.length;
    for (const d of linked) expect(d).toBeLessThan(avgAll);
    // Tabele jednego modułu bliżej siebie niż tabele z różnych modułów.
    expect(dist(a.get("notes")!, a.get("memories")!)).toBeLessThan(
      dist(a.get("notes")!, a.get("market_quotes")!),
    );
  });

  it("pusta baza — pusty układ", () => {
    expect(layoutSchema([], []).size).toBe(0);
  });
});
