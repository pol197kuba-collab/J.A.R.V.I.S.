// Macierz „narzędzie × agent” dla zakładki NARZĘDZIA w Agent Hub — jedno
// miejsce, w którym widać i przełącza, czym posługują się agenci. Czyste:
// dane z bazy i rejestru kodu wchodzą, wiersze pogrupowane w kategorie
// wychodzą (bez Reacta i bez Supabase).

export type ToolRiskKind = "read" | "write" | "external";

export type ToolCategoryId = "notes" | "tasks" | "documents" | "web" | "data" | "orders" | "team";

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategoryId; label: string }> = [
  { id: "notes", label: "Notatki i pamięć" },
  { id: "tasks", label: "Zadania i projekty" },
  { id: "documents", label: "Dokumenty" },
  { id: "web", label: "Internet" },
  { id: "data", label: "Rynki, paliwa i dojazd" },
  { id: "orders", label: "Briefing i stałe rozkazy" },
  { id: "team", label: "Zespół i system" },
];

const CATEGORY_OF: Readonly<Record<string, ToolCategoryId>> = {
  save_note: "notes",
  list_notes: "notes",
  delete_note: "notes",
  remember: "notes",
  recall: "notes",
  create_task: "tasks",
  list_tasks: "tasks",
  update_task: "tasks",
  delete_task: "tasks",
  list_projects: "tasks",
  create_project: "tasks",
  list_documents: "documents",
  search_documents: "documents",
  read_document: "documents",
  list_generated_files: "documents",
  read_generated_file: "documents",
  generate_document: "documents",
  queue_document_job: "documents",
  open_document: "documents",
  web_search: "web",
  fetch_url: "web",
  market_outlook: "data",
  fuel_outlook: "data",
  check_commute: "data",
  read_daily_brief: "orders",
  create_standing_order: "orders",
  list_standing_orders: "orders",
  cancel_standing_order: "orders",
  shield_scan_errors: "team",
  shield_run_stats: "team",
  shield_check_delegation: "team",
  delegate_to_agent: "team",
};

/** Nieznane narzędzie (nowe, bez wpisu wyżej) ląduje w „Zespół i system”. */
export const categoryOf = (slug: string): ToolCategoryId => CATEGORY_OF[slug] ?? "team";

export type MatrixAgent = { id: string; slug: string; name: string };

export type MatrixToolInput = {
  /** id wiersza w `tools`; null dla narzędzia tylko z kodu (np. delegate_to_agent). */
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  globallyEnabled: boolean;
  /** Klasa ryzyka z kodu; null, gdy kod nie zna narzędzia (wiersz bez implementacji). */
  risk: ToolRiskKind | null;
  untrusted: boolean;
};

export type CellState = "on" | "off" | "forced" | "blocked";

export type MatrixRow = {
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  risk: ToolRiskKind | null;
  untrusted: boolean;
  globallyEnabled: boolean;
  /** Kod nie zna narzędzia — wiersz w bazie bez implementacji, model go nie dostanie. */
  missingInCode: boolean;
  usage7d: number;
  cells: Record<string, CellState>;
};

export type MatrixGroup = { id: ToolCategoryId; label: string; rows: MatrixRow[] };

export type ToolMatrix = { agents: MatrixAgent[]; groups: MatrixGroup[] };

export function buildToolMatrix(input: {
  agents: readonly MatrixAgent[];
  tools: readonly MatrixToolInput[];
  /** Pary włączone w `agent_tools` (is_enabled = true). */
  bindings: ReadonlyArray<{ agentId: string; toolId: string }>;
  /** slug agenta → narzędzia zawsze dołączane w kodzie. */
  forced: Readonly<Record<string, readonly string[]>>;
  /** slug narzędzia → liczba wywołań z 7 dni (wszyscy agenci). */
  usage7d: Readonly<Record<string, number>>;
}): ToolMatrix {
  const on = new Set(input.bindings.map((b) => `${b.agentId}:${b.toolId}`));
  const rows: MatrixRow[] = input.tools.map((t) => {
    const cells: Record<string, CellState> = {};
    for (const a of input.agents) {
      if (input.forced[a.slug]?.includes(t.slug)) cells[a.slug] = "forced";
      else if (!t.globallyEnabled || t.risk === null) cells[a.slug] = "blocked";
      else cells[a.slug] = t.id !== null && on.has(`${a.id}:${t.id}`) ? "on" : "off";
    }
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      risk: t.risk,
      untrusted: t.untrusted,
      globallyEnabled: t.globallyEnabled,
      missingInCode: t.risk === null,
      usage7d: input.usage7d[t.slug] ?? 0,
      cells,
    };
  });

  const groups = TOOL_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    rows: rows
      .filter((r) => categoryOf(r.slug) === c.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pl")),
  })).filter((g) => g.rows.length > 0);

  return { agents: [...input.agents], groups };
}

/** Czy wiersz pasuje do wyszukiwania (nazwa, slug, opis) i filtra agenta. */
export function rowMatches(row: MatrixRow, query: string, agentSlug: string | null): boolean {
  if (agentSlug && row.cells[agentSlug] !== "on" && row.cells[agentSlug] !== "forced") {
    return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.slug, row.description ?? ""].some((s) => s.toLowerCase().includes(q));
}

/** Ile narzędzi ma agent (włączone + zawsze dołączane). */
export const toolCountFor = (m: ToolMatrix, agentSlug: string): number =>
  m.groups.reduce(
    (n, g) =>
      n +
      g.rows.filter((r) => r.cells[agentSlug] === "on" || r.cells[agentSlug] === "forced").length,
    0,
  );
