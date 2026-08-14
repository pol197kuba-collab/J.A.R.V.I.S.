// Single source of truth for every voice/text NAVIGATION and SYSTEM command
// JARVIS understands. Before this registry existed, the same vocabulary was
// hand-duplicated across four places (client regex list, UI_ACTIONS enum,
// the user-facing Command Directory panel, and the server's Polish
// confirmation lines) and drifted repeatedly — see PRs #43/#44 and the
// open_documents/open_schema gap. Add a new command here ONCE; every
// consumer (VoiceCommandContext, uiActions.ts, commandDirectory.ts,
// runtime.server.ts) derives from this array.
//
// `id` doubles as the JarvisAction/UiAction value used everywhere (regex
// match, Gemini's structured "action" field, the perform_ui_action tool).
import type { SubSystemId } from "@/data/subSystems";

export type CommandCategory = "Navigation" | "Interface" | "System";

/**
 * How `fire()` in VoiceCommandContext executes the command:
 * - "route": plain navigation to a static path.
 * - "module": navigation to /sub-systems with a pending module handoff.
 * - "special": bespoke side effect (menu toggle, vision scan, reboot, ...),
 *   handled by its own switch case — not data-driven, since each one differs.
 */
export type CommandKind =
  | { type: "route"; path: string }
  | { type: "module"; module: SubSystemId }
  | { type: "special" };

export type CommandDef = {
  id: string;
  category: CommandCategory;
  kind: CommandKind;
  /** EN + PL regex alternatives merged into one \b(...)\b pattern. */
  pattern: RegExp;
  /** Polish line spoken/shown when no Gemini-provided line is available. */
  confirmation: string;
  /** Short display name for the Command Directory panel. */
  label: string;
  /** Example phrases shown in the Command Directory panel. */
  phrases: string[];
  /** Longer description shown in the Command Directory panel. */
  description: string;
};

export const COMMAND_REGISTRY = [
  {
    id: "open_dashboard",
    category: "Navigation",
    kind: { type: "route", path: "/" },
    pattern:
      /\b(open\s+dashboard|show\s+status|show\s+core|jarvis\s+dashboard|otwórz\s+pulpit|otworz\s+pulpit|pokaż\s+dashboard|pokaz\s+dashboard|wróć\s+do\s+dashboardu|wroc\s+do\s+dashboardu)\b/i,
    confirmation: "Wracam do głównego kokpitu, Panie Sławiński.",
    label: "Open Dashboard",
    phrases: [
      "Jarvis open dashboard",
      "Show core",
      "Show status",
      "Jarvis, pokaż dashboard",
      "Jarvis, wróć do dashboardu",
      "Jarvis, otwórz pulpit",
    ],
    description: "Returns to the main HUD dashboard with the Arc Core, intel feed and chat stream.",
  },
  {
    id: "open_jarvis",
    category: "Navigation",
    kind: { type: "route", path: "/jarvis" },
    pattern:
      /\b(open\s+jarvis(?:\s+(?:panel|core|module))?|jarvis\s+panel|otwórz\s+jarvisa|otworz\s+jarvisa|pokaż\s+jarvisa|pokaz\s+jarvisa|panel\s+jarvisa)\b/i,
    confirmation: "Otwieram panel JARVIS.",
    label: "Open JARVIS",
    phrases: ["Open JARVIS panel", "Jarvis, otwórz panel JARVIS", "Jarvis, pokaż JARVISA"],
    description: "Opens the dedicated J.A.R.V.I.S. core panel.",
  },
  {
    id: "open_fuel",
    category: "Navigation",
    kind: { type: "module", module: "fuel-monitor" },
    pattern:
      /\b(open\s+fuel|launch\s+monitor|jarvis\s+fuel|otwórz\s+paliwo|otworz\s+paliwo|monitor\s+paliwa)\b/i,
    confirmation: "Ładuję Fuel Monitor Matrix, Panie Sławiński.",
    label: "Open Fuel Monitor",
    phrases: [
      "Jarvis open fuel",
      "Launch fuel monitor",
      "Jarvis, otwórz monitor paliwa",
      "Jarvis, pokaż paliwo",
    ],
    description: "Launches the Fuel Monitor Matrix sub-system inside the secure module frame.",
  },
  {
    id: "open_calculator",
    category: "Navigation",
    kind: { type: "module", module: "rto-calculator" },
    pattern:
      /\b(open\s+calculator|launch\s+rto|jarvis\s+office|otwórz\s+kalkulator|otworz\s+kalkulator|kalkulator\s+rto)\b/i,
    confirmation: "Uruchamiam kalkulator RTO.",
    label: "Open RTO Calculator",
    phrases: [
      "Jarvis open calculator",
      "Launch RTO",
      "Jarvis, otwórz kalkulator",
      "Jarvis, kalkulator RTO",
    ],
    description: "Loads the RTO calculation sub-system for road transport operations.",
  },
  {
    id: "open_jobfit",
    category: "Navigation",
    kind: { type: "module", module: "jobfit-ai" },
    pattern: /\b(open\s+jobfit|launch\s+ai|jarvis\s+job|otwórz\s+jobfit|otworz\s+jobfit)\b/i,
    confirmation: "Uruchamiam optymalizator CV.",
    label: "Open JobFit AI",
    phrases: [
      "Jarvis open jobfit",
      "Launch AI resume",
      "Jarvis, otwórz JobFit",
      "Jarvis, uruchom optymalizator CV",
    ],
    description: "Initializes the JobFit AI resume optimizer sub-system.",
  },
  {
    id: "open_telemetry",
    category: "Navigation",
    kind: { type: "route", path: "/situation-room" },
    pattern:
      /\b(show\s+telemetry|open\s+map|geo[-\s]?tracking|otwórz\s+mapę|otworz\s+mape|pokaż\s+mapę|pokaz\s+mape|geolokalizacja)\b/i,
    confirmation: "Uruchamiam telemetrię satelitarną.",
    label: "Open Situation Room",
    phrases: [
      "Show telemetry",
      "Open map",
      "Jarvis, pokaż mapę satelitarną",
      "Jarvis, otwórz geolokalizację",
    ],
    description:
      "Opens the Situation Room — live position radar, system events, weather and GitHub pulse.",
  },
  {
    id: "open_subsystems",
    category: "Navigation",
    kind: { type: "route", path: "/sub-systems" },
    pattern:
      /\b(open\s+sub[-\s]?systems|otwórz\s+podsystemy|otworz\s+podsystemy|pokaż\s+podsystemy|pokaz\s+podsystemy)\b/i,
    confirmation: "Otwieram podsystemy.",
    label: "Open Sub-Systems",
    phrases: ["Open sub-systems", "Jarvis, otwórz podsystemy", "Jarvis, pokaż podsystemy"],
    description: "Opens the full sub-systems grid (Fuel Monitor, RTO, JobFit and more).",
  },
  {
    id: "open_agents",
    category: "Navigation",
    kind: { type: "route", path: "/agent-hub" },
    pattern:
      /\b(open\s+agents?|agent\s+hub|otwórz\s+agentów|otworz\s+agentow|pokaż\s+agentów|pokaz\s+agentow)\b/i,
    confirmation: "Przechodzę do Agent Hub, sir.",
    label: "Open Agent Hub",
    phrases: ["Open Agent Hub", "Show agents", "Jarvis, otwórz Agent Hub", "Jarvis, pokaż agentów"],
    description:
      "Opens the Agent Hub — full registry of JARVIS sub-agents with per-agent console access.",
  },
  {
    id: "open_settings",
    category: "Navigation",
    kind: { type: "route", path: "/settings" },
    pattern:
      /\b(open\s+settings|otwórz\s+ustawienia|otworz\s+ustawienia|pokaż\s+ustawienia|pokaz\s+ustawienia|konfiguracja)\b/i,
    confirmation: "Otwieram konfigurację.",
    label: "Open Settings",
    phrases: ["Open settings", "Jarvis, otwórz ustawienia", "Jarvis, konfiguracja"],
    description: "Opens the JARVIS configuration panel (AI core, audio, voice, tools, commands).",
  },
  {
    id: "open_logs",
    category: "Navigation",
    kind: { type: "route", path: "/system-logs" },
    pattern:
      /\b(open\s+logs|system\s+logs|otwórz\s+logi|otworz\s+logi|pokaż\s+logi|pokaz\s+logi|dziennik\s+systemu)\b/i,
    confirmation: "Otwieram dziennik systemu.",
    label: "Open System Logs",
    phrases: ["Open system logs", "Jarvis, otwórz logi", "Jarvis, pokaż dziennik systemu"],
    description: "Opens the system event log with agent runs, tool calls and warnings.",
  },
  {
    id: "open_tasks",
    category: "Navigation",
    kind: { type: "route", path: "/tasks" },
    pattern:
      /\b(open\s+tasks?|task\s+queue|otwórz\s+zadania|otworz\s+zadania|pokaż\s+zadania|pokaz\s+zadania|moje\s+zadania|lista\s+zadań|lista\s+zadan)\b/i,
    confirmation: "Otwieram kolejkę zadań, sir.",
    label: "Open Tasks",
    phrases: ["Open tasks", "Jarvis, otwórz zadania", "Jarvis, pokaż moje zadania"],
    description: "Opens the task queue — to-do items you and the agents create and track.",
  },
  {
    id: "open_documents",
    category: "Navigation",
    kind: { type: "route", path: "/documents" },
    // Bare "open the documents module". A specific "otwórz prezentację o X"
    // is handled by the chat agent's open_document tool (it finds the file);
    // this only opens the module.
    pattern:
      /\b(open\s+documents?|show\s+files?|otwórz\s+dokumenty|otworz\s+dokumenty|pokaż\s+dokumenty|pokaz\s+dokumenty|otwórz\s+pliki|otworz\s+pliki|moduł\s+dokumentów|modul\s+dokumentow|archiwum\s+plików|archiwum\s+plikow)\b/i,
    confirmation: "Otwieram moduł dokumentów, sir.",
    label: "Open Documents",
    phrases: ["Open documents", "Show files", "Jarvis, otwórz dokumenty", "Jarvis, pokaż pliki"],
    description: "Opens the Documents module (file archive).",
  },
  {
    id: "open_schema",
    category: "Navigation",
    kind: { type: "route", path: "/schema" },
    pattern:
      /\b(open\s+schema|schema\s+explorer|otwórz\s+schemat|otworz\s+schemat|pokaż\s+schemat|pokaz\s+schemat|eksplorator\s+schematu)\b/i,
    confirmation: "Otwieram eksplorator schematu.",
    label: "Open Schema",
    phrases: ["Open schema", "Schema explorer", "Jarvis, otwórz schemat"],
    description: "Opens the Schema Explorer.",
  },
  {
    id: "open_vision",
    category: "Navigation",
    kind: { type: "route", path: "/vision" },
    // Plain "open the vision module" without triggering a scan. Actually
    // performing a scan ("co widzisz") is the separate vision_scan action.
    pattern:
      /\b(open\s+vision|show\s+vision|vision\s+module|otwórz\s+wizję|otworz\s+wizje|pokaż\s+wizję|pokaz\s+wizje|moduł\s+wizji|modul\s+wizji)\b/i,
    confirmation: "Otwieram moduł wizji.",
    label: "Open Vision",
    phrases: ["Open vision module", "Jarvis, otwórz moduł wizji", "Jarvis, pokaż wizję"],
    description: "Opens the Vision module without starting a scan.",
  },
  {
    id: "open_commands",
    category: "Navigation",
    kind: { type: "route", path: "/commands" },
    pattern:
      /\b(open\s+commands?|command\s+directory|command\s+playground|otwórz\s+komendy|otworz\s+komendy|pokaż\s+komendy|pokaz\s+komendy|lista\s+komend|katalog\s+komend)\b/i,
    confirmation: "Otwieram katalog komend.",
    label: "Open Commands",
    phrases: [
      "Open commands",
      "Command directory",
      "Jarvis, otwórz komendy",
      "Jarvis, pokaż listę komend",
    ],
    description:
      "Opens the Commands module — the full command directory plus a live test playground.",
  },
  {
    id: "open_menu",
    category: "Interface",
    kind: { type: "special" },
    pattern:
      /\b(open\s+menu|show\s+sidebar|otwórz\s+menu|otworz\s+menu|pokaż\s+menu|pokaz\s+menu)\b/i,
    confirmation: "Otwieram menu.",
    label: "Open Sidebar",
    phrases: [
      "Jarvis open menu",
      "Show sidebar",
      "Jarvis, otwórz menu",
      "Jarvis, pokaż menu boczne",
    ],
    description: "Reveals the side navigation drawer (primarily for mobile devices).",
  },
  {
    id: "close_menu",
    category: "Interface",
    kind: { type: "special" },
    pattern: /\b(close\s+menu|hide\s+sidebar|zamknij\s+menu|schowaj\s+menu|ukryj\s+menu)\b/i,
    confirmation: "Zamykam menu.",
    label: "Close Sidebar",
    phrases: ["Jarvis close menu", "Hide sidebar", "Jarvis, zamknij menu", "Jarvis, schowaj menu"],
    description: "Collapses the side navigation drawer.",
  },
  {
    id: "vision_scan",
    category: "System",
    kind: { type: "special" },
    pattern:
      /\b(co\s+widzisz|powiedz\s+co\s+widzisz|zeskanuj\s+otoczenie|przeskanuj\s+otoczenie|skanuj\s+otoczenie|zeskanuj\s+to|what\s+do\s+you\s+see|scan\s+(?:the\s+)?(?:room|area|surroundings)|vision\s+scan)\b/i,
    confirmation: "Analizuję obraz z czujników optycznych.",
    label: "Vision Scan",
    phrases: [
      "What do you see",
      "Scan the room",
      "Jarvis, co widzisz",
      "Jarvis, zeskanuj otoczenie",
    ],
    description: "Opens the Vision module and runs an optical scan of the surroundings.",
  },
  {
    id: "system_check",
    category: "System",
    kind: { type: "special" },
    pattern:
      /\b(system\s+check|sprawdź\s+system|sprawdz\s+system|status\s+systemu|raport\s+systemu)\b/i,
    confirmation: "Wszystkie systemy sprawne, Panie Sławiński. Temperatura rdzenia nominalna.",
    label: "System Check",
    phrases: [
      "Jarvis system check",
      "Status report",
      "Jarvis, sprawdź system",
      "Jarvis, raport systemu",
      "Jarvis, status systemu",
    ],
    description: "Runs a verbal status report on JARVIS core systems.",
  },
  {
    id: "sleep",
    category: "System",
    kind: { type: "special" },
    pattern: /\b(jarvis\s+sleep|standby|uśpij|uspij|tryb\s+czuwania|stan\s+czuwania)\b/i,
    confirmation: "Przechodzę w tryb czuwania, Panie Sławiński.",
    label: "Standby Mode",
    phrases: ["Jarvis sleep", "Standby", "Jarvis, uśpij", "Jarvis, tryb czuwania"],
    description: "Disables the continuous voice listener and enters standby mode.",
  },
  {
    id: "shutdown",
    category: "System",
    kind: { type: "special" },
    pattern:
      /\b(disconnect|shutdown|system\s+shutdown|wyłącz\s+system|wylacz\s+system|zamknij\s+system|rozłącz|rozlacz)\b/i,
    confirmation: "Wyłączam system. Do zobaczenia, Panie Sławiński.",
    label: "Shutdown",
    phrases: [
      "Jarvis shutdown",
      "Disconnect",
      "System shutdown",
      "Jarvis, wyłącz system",
      "Jarvis, zamknij system",
    ],
    description: "Initiates the full deactivation sequence and returns to the boot screen.",
  },
  {
    id: "reboot",
    category: "System",
    kind: { type: "special" },
    pattern:
      /\b(reboot|restart|reset|zrestartuj|zresetuj|ark\s+reboot|zrestartuj\s+system|uruchom\s+ponownie)\b/i,
    confirmation: "Przyjąłem. Uruchamiam Protokół Ark Reboot.",
    label: "Ark Reboot",
    phrases: [
      "Reboot",
      "Restart system",
      "Ark reboot",
      "Jarvis, zrestartuj system",
      "Jarvis, uruchom ponownie",
    ],
    description:
      "Triggers Protocol: Ark Reboot — a cinematic full-stack module diagnostic sweep, then returns to the dashboard.",
  },
] as const satisfies readonly CommandDef[];

/** Literal union of every command id — derived, never hand-maintained. */
export type CommandActionId = (typeof COMMAND_REGISTRY)[number]["id"];

export function getCommand(id: string): (typeof COMMAND_REGISTRY)[number] | undefined {
  return COMMAND_REGISTRY.find((c) => c.id === id);
}
