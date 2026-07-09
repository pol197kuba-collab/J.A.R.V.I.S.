import type { JarvisAction } from "@/lib/ai/jarvisBrain";

export type CommandCategory = "Navigation" | "Interface" | "System";

export type CommandEntry = {
  action: Exclude<JarvisAction, "none">;
  label: string;
  phrases: string[];
  description: string;
  category: CommandCategory;
};

export const COMMAND_DIRECTORY: CommandEntry[] = [
  {
    action: "open_dashboard",
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
    category: "Navigation",
  },
  {
    action: "open_fuel",
    label: "Open Fuel Monitor",
    phrases: [
      "Jarvis open fuel",
      "Launch fuel monitor",
      "Jarvis, otwórz monitor paliwa",
      "Jarvis, pokaż paliwo",
    ],
    description: "Launches the Fuel Monitor Matrix sub-system inside the secure module frame.",
    category: "Navigation",
  },
  {
    action: "open_calculator",
    label: "Open RTO Calculator",
    phrases: [
      "Jarvis open calculator",
      "Launch RTO",
      "Jarvis, otwórz kalkulator",
      "Jarvis, kalkulator RTO",
    ],
    description: "Loads the RTO calculation sub-system for road transport operations.",
    category: "Navigation",
  },
  {
    action: "open_jobfit",
    label: "Open JobFit AI",
    phrases: [
      "Jarvis open jobfit",
      "Launch AI resume",
      "Jarvis, otwórz JobFit",
      "Jarvis, uruchom optymalizator CV",
    ],
    description: "Initializes the JobFit AI resume optimizer sub-system.",
    category: "Navigation",
  },
  {
    action: "open_telemetry",
    label: "Open Geo-Tracking",
    phrases: [
      "Show telemetry",
      "Open map",
      "Jarvis, pokaż mapę satelitarną",
      "Jarvis, otwórz geolokalizację",
    ],
    description: "Opens the satellite telemetry route with the live geo-tracking map.",
    category: "Navigation",
  },
  {
    action: "open_subsystems",
    label: "Open Sub-Systems",
    phrases: [
      "Open sub-systems",
      "Jarvis, otwórz podsystemy",
      "Jarvis, pokaż podsystemy",
    ],
    description: "Opens the full sub-systems grid (Fuel Monitor, RTO, JobFit and more).",
    category: "Navigation",
  },
  {
    action: "open_agents",
    label: "Open Agent Hub",
    phrases: [
      "Open Agent Hub",
      "Show agents",
      "Jarvis, otwórz Agent Hub",
      "Jarvis, pokaż agentów",
    ],
    description: "Opens the Agent Hub — full registry of JARVIS sub-agents with per-agent console access.",
    category: "Navigation",
  },
  {
    action: "open_settings",
    label: "Open Settings",
    phrases: [
      "Open settings",
      "Jarvis, otwórz ustawienia",
      "Jarvis, konfiguracja",
    ],
    description: "Opens the JARVIS configuration panel (AI core, audio, voice, tools, commands).",
    category: "Navigation",
  },
  {
    action: "open_logs",
    label: "Open System Logs",
    phrases: [
      "Open system logs",
      "Jarvis, otwórz logi",
      "Jarvis, pokaż dziennik systemu",
    ],
    description: "Opens the system event log with agent runs, tool calls and warnings.",
    category: "Navigation",
  },
  {
    action: "open_menu",
    label: "Open Sidebar",
    phrases: [
      "Jarvis open menu",
      "Show sidebar",
      "Jarvis, otwórz menu",
      "Jarvis, pokaż menu boczne",
    ],
    description: "Reveals the side navigation drawer (primarily for mobile devices).",
    category: "Interface",
  },
  {
    action: "close_menu",
    label: "Close Sidebar",
    phrases: [
      "Jarvis close menu",
      "Hide sidebar",
      "Jarvis, zamknij menu",
      "Jarvis, schowaj menu",
    ],
    description: "Collapses the side navigation drawer.",
    category: "Interface",
  },
  {
    action: "system_check",
    label: "System Check",
    phrases: [
      "Jarvis system check",
      "Status report",
      "Jarvis, sprawdź system",
      "Jarvis, raport systemu",
      "Jarvis, status systemu",
    ],
    description: "Runs a verbal status report on JARVIS core systems.",
    category: "System",
  },
  {
    action: "sleep",
    label: "Standby Mode",
    phrases: [
      "Jarvis sleep",
      "Standby",
      "Jarvis, uśpij",
      "Jarvis, tryb czuwania",
    ],
    description: "Disables the continuous voice listener and enters standby mode.",
    category: "System",
  },
  {
    action: "shutdown",
    label: "Shutdown",
    phrases: [
      "Jarvis shutdown",
      "Disconnect",
      "System shutdown",
      "Jarvis, wyłącz system",
      "Jarvis, zamknij system",
    ],
    description: "Initiates the full deactivation sequence and returns to the boot screen.",
    category: "System",
  },
  {
    action: "reboot",
    label: "Ark Reboot",
    phrases: [
      "Reboot",
      "Restart system",
      "Ark reboot",
      "Jarvis, zrestartuj system",
      "Jarvis, uruchom ponownie",
    ],
    description: "Triggers Protocol: Ark Reboot — a cinematic full-stack module diagnostic sweep, then returns to the dashboard.",
    category: "System",
  },
];