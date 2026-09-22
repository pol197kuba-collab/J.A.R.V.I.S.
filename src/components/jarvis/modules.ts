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
  type LucideIcon,
} from "lucide-react";

export type ModuleEntry = {
  /** Sidebar / command-palette label. */
  title: string;
  /** Shorter label for the mobile bottom rail, where ~64px is all a cell gets. */
  shortTitle: string;
  url: string;
  icon: LucideIcon;
  /** Extra search terms for the command palette (synonyms, PL/EN pairs). */
  keywords?: string;
};

export type ModuleGroup = {
  /** Stable key — also the localStorage key suffix for the collapsed state. */
  id: string;
  label: string;
  items: readonly ModuleEntry[];
};

/**
 * The single source of truth for JARVIS navigation.
 *
 * Grouped rather than flat: sixteen equal-weight entries is more than a
 * sidebar can be scanned at a glance, and the flat list was also what
 * pushed the rail past the viewport height outside fullscreen. The groups
 * are ordered by how often a session actually starts there, not
 * alphabetically.
 */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    id: "core",
    label: "Core",
    items: [
      { title: "J.A.R.V.I.S.", shortTitle: "JARVIS", url: "/jarvis", icon: Hexagon },
      { title: "Dashboard", shortTitle: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Feed", shortTitle: "Feed", url: "/feed", icon: Rss, keywords: "aktualności news" },
    ],
  },
  {
    id: "data",
    label: "Dane",
    items: [
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
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [
      {
        title: "Agent Hub",
        shortTitle: "Agents",
        url: "/agent-hub",
        icon: Bot,
        keywords: "agenci delegacja",
      },
      { title: "Tasks", shortTitle: "Tasks", url: "/tasks", icon: ListChecks, keywords: "zadania" },
      { title: "Notes", shortTitle: "Notes", url: "/notes", icon: StickyNote, keywords: "notatki" },
      {
        title: "Situation Room",
        shortTitle: "Situation",
        url: "/situation-room",
        icon: Radar,
        keywords: "mapa satelita telemetria",
      },
    ],
  },
  {
    id: "system",
    label: "System",
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
        title: "Documents",
        shortTitle: "Docs",
        url: "/documents",
        icon: FileText,
        keywords: "dokumenty pliki",
      },
      { title: "Commands", shortTitle: "Commands", url: "/commands", icon: Command },
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

/** Flat view, in group order — for the mobile rail and the command palette. */
export const MODULE_ITEMS: readonly ModuleEntry[] = MODULE_GROUPS.flatMap((g) => g.items);

/**
 * Label of the module owning `pathname`, for the header breadcrumb.
 * Exact match only: every route in MODULE_ITEMS is a top-level module, and
 * a prefix match would make "/" (Dashboard) claim every other route.
 */
export function moduleTitleFor(pathname: string): string | null {
  return MODULE_ITEMS.find((m) => m.url === pathname)?.title ?? null;
}
