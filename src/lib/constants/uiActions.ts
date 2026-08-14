// Single source of truth for the UI action vocabulary that J.A.R.V.I.S. (or
// any agent facing the user directly) can trigger — via the server-side
// perform_ui_action tool (runtime.server.ts) or the client-side structured
// "action" field (jarvisBrain.ts SYSTEM_PROMPT). Both derive from
// COMMAND_REGISTRY (src/lib/commands/registry.ts), the actual command list,
// so adding a command there is enough — nothing to keep in sync here. This
// drifted silently twice before that unification (system_check shadowing
// the S.H.I.E.L.D. agent, PRs #43/#44).
import { COMMAND_REGISTRY } from "@/lib/commands/registry";

export const UI_ACTIONS = COMMAND_REGISTRY.map((c) => c.id);

export type UiAction = (typeof COMMAND_REGISTRY)[number]["id"];
