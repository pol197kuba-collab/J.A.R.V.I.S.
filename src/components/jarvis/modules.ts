import {
  LayoutDashboard,
  Hexagon,
  Bot,
  Terminal,
  Settings as SettingsIcon,
  Boxes,
  Radar,
  Eye,
  ListChecks,
  Database,
  FileText,
  Command,
  StickyNote,
  Rss,
  CandlestickChart,
  Fuel,
  Castle,
  Brain,
  Wallet,
  Briefcase,
  Cpu,
  type LucideIcon,
} from "lucide-react";

export type ModuleEntry = {
  /** Sidebar / command-palette label. */
  title: string;
  /** Shorter label for the mobile reactor menu, where a node is ~64px wide. */
  shortTitle: string;
  url: string;
  icon: LucideIcon;
  /** Extra search terms for the command palette (synonyms, PL/EN pairs). */
  keywords?: string;
  /**
   * Reachable from the command palette only — no slot in the sidebar or the
   * mobile menu. Agent Town is one: the header's HUD/TOWN switch is its door.
   */
  paletteOnly?: boolean;
};

export type ModuleGroup = {
  /** Stable key — also the localStorage key suffix for the collapsed state. */
  id: string;
  label: string;
  /** Group node in the mobile reactor menu. */
  icon: LucideIcon;
  items: readonly ModuleEntry[];
};

/**
 * The single source of truth for JARVIS navigation.
 *
 * Grouped by what the module is for, not by data type: what starts a
 * session, the owner's own affairs, the agents, and the machinery. The
 * groups are ordered by how often a session actually starts there.
 */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    id: "start",
    label: "Start",
    icon: Hexagon,
    items: [
      { title: "J.A.R.V.I.S.", shortTitle: "JARVIS", url: "/jarvis", icon: Hexagon },
      { title: "Dashboard", shortTitle: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Feed", shortTitle: "Feed", url: "/feed", icon: Rss, keywords: "aktualności news" },
      {
        title: "Mózg",
        shortTitle: "Mózg",
        url: "/mozg",
        icon: Brain,
        keywords: "brain wiedza mapa 3d galaktyka notatki wspomnienia mozg",
      },
      {
        title: "Agent Town",
        shortTitle: "Town",
        url: "/town",
        icon: Castle,
        keywords: "miasto świat agenci pixel rpg",
        paletteOnly: true,
      },
    ],
  },
  {
    id: "affairs",
    label: "Moje sprawy",
    icon: Briefcase,
    items: [
      {
        title: "Wydatki",
        shortTitle: "Wydatki",
        url: "/wydatki",
        icon: Wallet,
        keywords: "paragony expenses budżet zakupy koszty",
      },
      {
        title: "Paliwa",
        shortTitle: "Paliwa",
        url: "/paliwa",
        icon: Fuel,
        keywords: "orlen cennik diesel benzyna fuel",
      },
      {
        title: "Rynki",
        shortTitle: "Rynki",
        url: "/rynki",
        icon: CandlestickChart,
        keywords: "markets giełda kursy",
      },
      { title: "Vision", shortTitle: "Vision", url: "/vision", icon: Eye, keywords: "skan obraz" },
      { title: "Tasks", shortTitle: "Tasks", url: "/tasks", icon: ListChecks, keywords: "zadania" },
      { title: "Notes", shortTitle: "Notes", url: "/notes", icon: StickyNote, keywords: "notatki" },
      {
        title: "Documents",
        shortTitle: "Docs",
        url: "/documents",
        icon: FileText,
        keywords: "dokumenty pliki",
      },
    ],
  },
  {
    id: "agents",
    label: "Agenci",
    icon: Bot,
    items: [
      {
        title: "Agent Hub",
        shortTitle: "Agents",
        url: "/agent-hub",
        icon: Bot,
        keywords: "agenci delegacja",
      },
      {
        title: "Situation Room",
        shortTitle: "Situation",
        url: "/situation-room",
        icon: Radar,
        keywords: "mapa satelita telemetria",
      },
      { title: "Commands", shortTitle: "Commands", url: "/commands", icon: Command },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Cpu,
    items: [
      { title: "Sub-Systems", shortTitle: "Systems", url: "/sub-systems", icon: Boxes },
      {
        title: "System Logs",
        shortTitle: "Logs",
        url: "/system-logs",
        icon: Terminal,
        keywords: "logi błędy",
      },
      {
        title: "Schema",
        shortTitle: "Schema",
        url: "/schema",
        icon: Database,
        keywords: "baza db",
      },
      {
        title: "Settings",
        shortTitle: "Settings",
        url: "/settings",
        icon: SettingsIcon,
        keywords: "ustawienia konfiguracja",
      },
    ],
  },
] as const;

/** Groups as the sidebar and the mobile menu show them — palette-only entries left out. */
export const MENU_GROUPS: readonly ModuleGroup[] = MODULE_GROUPS.map((g) => ({
  ...g,
  items: g.items.filter((i) => !i.paletteOnly),
}));

/** Flat view, in group order — every module, palette-only ones included. */
export const MODULE_ITEMS: readonly ModuleEntry[] = MODULE_GROUPS.flatMap((g) => g.items);

/**
 * Label of the module owning `pathname`, for the header breadcrumb.
 * Exact match only: every route in MODULE_ITEMS is a top-level module, and
 * a prefix match would make "/" (Dashboard) claim every other route.
 */
export function moduleTitleFor(pathname: string): string | null {
  return MODULE_ITEMS.find((m) => m.url === pathname)?.title ?? null;
}
