import { describe, expect, it } from "vitest";
import {
  buildToolMatrix,
  categoryOf,
  rowMatches,
  toolCountFor,
  type MatrixToolInput,
} from "./toolMatrix";

const agents = [
  { id: "a1", slug: "jarvis", name: "J.A.R.V.I.S." },
  { id: "a2", slug: "forge", name: "F.O.R.G.E." },
];

const tool = (over: Partial<MatrixToolInput>): MatrixToolInput => ({
  id: "t1",
  slug: "save_note",
  name: "Notatka: Zapisz",
  description: "Zapisuje notatkę.",
  globallyEnabled: true,
  risk: "write",
  untrusted: false,
  ...over,
});

const matrix = (tools: MatrixToolInput[], bindings = [{ agentId: "a1", toolId: "t1" }]) =>
  buildToolMatrix({
    agents,
    tools,
    bindings,
    forced: { forge: ["generate_document"], jarvis: ["delegate_to_agent"] },
    usage7d: { save_note: 4 },
  });

describe("buildToolMatrix", () => {
  it("komórka: włączone w agent_tools → on, brak powiązania → off", () => {
    const m = matrix([tool({})]);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].label).toBe("Notatki i pamięć");
    expect(m.groups[0].rows[0].cells).toEqual({ jarvis: "on", forge: "off" });
    expect(m.groups[0].rows[0].usage7d).toBe(4);
  });

  it("narzędzie dołączane w kodzie jest 'forced' niezależnie od bazy", () => {
    const m = matrix([
      tool({ id: "t2", slug: "generate_document", name: "Dokument: Generuj" }),
      tool({ id: null, slug: "delegate_to_agent", name: "Delegacja", risk: "write" }),
    ]);
    const rows = m.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.slug === "generate_document")!.cells.forge).toBe("forced");
    expect(rows.find((r) => r.slug === "delegate_to_agent")!.cells).toEqual({
      jarvis: "forced",
      forge: "off",
    });
  });

  it("globalnie wyłączone albo bez implementacji w kodzie → zablokowane", () => {
    const m = matrix([
      tool({ globallyEnabled: false }),
      tool({ id: "t9", slug: "start_dev_session", name: "Stare", risk: null }),
    ]);
    const rows = m.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.slug === "save_note")!.cells.jarvis).toBe("blocked");
    const stale = rows.find((r) => r.slug === "start_dev_session")!;
    expect(stale.missingInCode).toBe(true);
    expect(stale.cells).toEqual({ jarvis: "blocked", forge: "blocked" });
  });

  it("kategorie w stałej kolejności, wiersze po polsku alfabetycznie", () => {
    const m = matrix([
      tool({ id: "w", slug: "web_search", name: "Sieć: Szukaj" }),
      tool({ id: "n2", slug: "list_notes", name: "Notatka: Lista" }),
      tool({}),
    ]);
    expect(m.groups.map((g) => g.id)).toEqual(["notes", "web"]);
    expect(m.groups[0].rows.map((r) => r.slug)).toEqual(["list_notes", "save_note"]);
  });
});

describe("filtrowanie i liczniki", () => {
  const m = matrix([
    tool({}),
    tool({ id: "w", slug: "web_search", name: "Sieć: Szukaj", description: "Szuka w sieci." }),
  ]);
  const rows = m.groups.flatMap((g) => g.rows);

  it("szukanie po nazwie, slugu i opisie, bez wielkości liter", () => {
    expect(rows.filter((r) => rowMatches(r, "NOTAT", null)).map((r) => r.slug)).toEqual([
      "save_note",
    ]);
    expect(rows.filter((r) => rowMatches(r, "web_", null)).map((r) => r.slug)).toEqual([
      "web_search",
    ]);
  });

  it("filtr agenta zostawia tylko jego narzędzia", () => {
    expect(rows.filter((r) => rowMatches(r, "", "jarvis")).map((r) => r.slug)).toEqual([
      "save_note",
    ]);
    expect(toolCountFor(m, "jarvis")).toBe(1);
    expect(toolCountFor(m, "forge")).toBe(0);
  });

  it("nieznane narzędzie trafia do 'Zespół i system'", () => {
    expect(categoryOf("cos_nowego")).toBe("team");
  });
});
