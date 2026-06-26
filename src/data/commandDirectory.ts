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
    phrases: ["Jarvis open dashboard", "Show core", "Pokaż dashboard"],
    description: "Returns to the main HUD dashboard with the Arc Core, intel feed and chat stream.",
    category: "Navigation",
  },
  {
    action: "open_fuel",
    label: "Open Fuel Monitor",
    phrases: ["Jarvis open fuel", "Launch fuel monitor", "Otwórz monitor paliwa"],
    description: "Launches the Fuel Monitor Matrix sub-system inside the secure module frame.",
    category: "Navigation",
  },
  {
    action: "open_calculator",
    label: "Open RTO Calculator",
    phrases: ["Jarvis open calculator", "Launch RTO", "Otwórz kalkulator RTO"],
    description: "Loads the RTO calculation sub-system for road transport operations.",
    category: "Navigation",
  },
  {
    action: "open_jobfit",
    label: "Open JobFit AI",
    phrases: ["Jarvis open jobfit", "Launch AI resume", "Otwórz JobFit"],
    description: "Initializes the JobFit AI resume optimizer sub-system.",
    category: "Navigation",
  },
  {
    action: "open_telemetry",
    label: "Open Geo-Tracking",
    phrases: ["Show telemetry", "Open map", "Pokaż mapę satelitarną"],
    description: "Opens the satellite telemetry route with the live geo-tracking map.",
    category: "Navigation",
  },
  {
    action: "open_menu",
    label: "Open Sidebar",
    phrases: ["Jarvis open menu", "Show sidebar"],
    description: "Reveals the side navigation drawer (primarily for mobile devices).",
    category: "Interface",
  },
  {
    action: "close_menu",
    label: "Close Sidebar",
    phrases: ["Jarvis close menu", "Hide sidebar"],
    description: "Collapses the side navigation drawer.",
    category: "Interface",
  },
  {
    action: "system_check",
    label: "System Check",
    phrases: ["Jarvis system check", "Status report"],
    description: "Runs a verbal status report on JARVIS core systems.",
    category: "System",
  },
  {
    action: "sleep",
    label: "Standby Mode",
    phrases: ["Jarvis sleep", "Standby"],
    description: "Disables the continuous voice listener and enters standby mode.",
    category: "System",
  },
  {
    action: "shutdown",
    label: "Shutdown",
    phrases: ["Jarvis shutdown", "Disconnect", "System shutdown"],
    description: "Initiates the full deactivation sequence and returns to the boot screen.",
    category: "System",
  },
];