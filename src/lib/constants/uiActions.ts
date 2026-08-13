// Single source of truth for the UI action vocabulary that J.A.R.V.I.S. (or
// any agent facing the user directly) can trigger — via the server-side
// perform_ui_action tool (runtime.server.ts) or the client-side structured
// "action" field (jarvisBrain.ts SYSTEM_PROMPT). The two paths drifted
// silently twice before this was unified (system_check shadowing the
// S.H.I.E.L.D. agent, PRs #43/#44) — keep every action name here and let
// both call sites import it instead of maintaining their own copy.
export const UI_ACTIONS = [
  "open_dashboard",
  "open_fuel",
  "open_calculator",
  "open_jobfit",
  "open_telemetry",
  "open_menu",
  "close_menu",
  "system_check",
  "sleep",
  "shutdown",
  "reboot",
  "open_agents",
  "open_settings",
  "open_logs",
  "open_tasks",
  "open_subsystems",
  "open_documents",
  "open_schema",
  "vision_scan",
] as const;

export type UiAction = (typeof UI_ACTIONS)[number];
