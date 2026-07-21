import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTasks from "./tools/list-tasks";
import createTask from "./tools/create-task";
import listNotes from "./tools/list-notes";
import createNote from "./tools/create-note";
import listAgents from "./tools/list-agents";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to the .lovable.cloud proxy, which mcp-js rejects (RFC 8414 issuer
// mismatch). Use the project ref, inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "jarvis-mcp",
  title: "JARVIS",
  version: "0.1.0",
  instructions:
    "Tools for the JARVIS personal AI assistant. Use these to list and create the signed-in user's tasks, notes, and to inspect their registered sub-agents.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTasks, createTask, listNotes, createNote, listAgents],
});
