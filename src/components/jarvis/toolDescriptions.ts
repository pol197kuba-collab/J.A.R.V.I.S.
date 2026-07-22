// Human-readable descriptions for agent tool calls, used by AgentFlowTree
// to turn a raw tool name + args into something a person can read at a
// glance (e.g. "search_documents" -> 🔍 szuka w dokumentach: „co jest w
// umowie"). Keyed by the exact `public.tools.slug` / declaration name.
//
// Growth point for future agents: when Researcher/Producer (or any new
// agent) gets new tools, add one entry here — everything else (the tree
// rendering, the live-progress plumbing) is already generic and needs no
// further changes. An unknown tool falls back to a plain "⚙️ {name}" chip
// rather than breaking or looking empty.

function truncate(s: string, max = 60): string {
  const trimmed = s.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

type ToolArgs = Record<string, unknown>;
type Describer = (args: ToolArgs) => string;

const str = (args: ToolArgs, key: string, fallback = "?"): string => {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v : fallback;
};

const TOOL_DESCRIPTIONS: Record<string, Describer> = {
  web_search: (a) => `🔍 szuka w sieci: „${truncate(str(a, "query"))}"`,
  fetch_url: (a) => `🌐 czyta stronę: ${truncate(str(a, "url"), 50)}`,
  save_note: (a) => `📝 zapisuje notatkę: „${truncate(str(a, "title"))}"`,
  list_notes: () => `📒 przegląda notatki`,
  delete_note: () => `🗑️ usuwa notatkę`,
  remember: (a) => `🧠 zapamiętuje: „${truncate(str(a, "value"))}"`,
  recall: (a) => {
    const q = str(a, "query", "");
    return q ? `🧠 przypomina sobie: „${truncate(q)}"` : `🧠 przegląda pamięć`;
  },
  create_task: (a) => `✅ tworzy zadanie: „${truncate(str(a, "title"))}"`,
  list_tasks: () => `📋 przegląda zadania`,
  update_task: (a) => {
    const status = str(a, "status", "");
    return status ? `✅ aktualizuje zadanie → ${status}` : `✅ aktualizuje zadanie`;
  },
  delete_task: () => `🗑️ usuwa zadanie`,
  guardian_scan_errors: () => `🛡️ skanuje logi błędów`,
  guardian_run_stats: () => `🛡️ liczy statystyki agentów`,
  guardian_check_delegation: () => `🛡️ sprawdza integralność delegacji`,
  list_documents: () => `📁 przegląda dokumenty`,
  search_documents: (a) => `🔍 szuka w dokumentach: „${truncate(str(a, "query"))}"`,
  generate_document: (a) => `📄 generuje plik ${str(a, "format")}: „${truncate(str(a, "title"))}"`,
  perform_ui_action: (a) => `🖥️ steruje interfejsem: ${str(a, "action")}`,
};

export function describeToolCall(name: string, args: ToolArgs): string {
  const describer = TOOL_DESCRIPTIONS[name];
  if (describer) {
    try {
      return describer(args);
    } catch {
      // A future tool's args shape changing shouldn't ever crash the tree.
      return `⚙️ ${name}`;
    }
  }
  return `⚙️ ${name}`;
}
