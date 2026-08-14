// The Command Directory panel's data, derived from COMMAND_REGISTRY
// (src/lib/commands/registry.ts) — the single source of truth for every
// voice/text command. Add a command to the registry and it appears here
// automatically; this file used to hand-duplicate the phrase list and
// silently went stale (open_documents/open_schema were missing).
import { COMMAND_REGISTRY, type CommandCategory } from "@/lib/commands/registry";

export type { CommandCategory };

export type CommandEntry = {
  action: string;
  label: string;
  phrases: string[];
  description: string;
  category: CommandCategory;
};

export const COMMAND_DIRECTORY: CommandEntry[] = COMMAND_REGISTRY.map((c) => ({
  action: c.id,
  label: c.label,
  phrases: c.phrases,
  description: c.description,
  category: c.category,
}));
