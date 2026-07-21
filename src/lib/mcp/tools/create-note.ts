import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "create_note",
  title: "Create note",
  description: "Save a new note to the signed-in user's JARVIS notes.",
  inputSchema: {
    title: z.string().min(1).max(200).describe("Short note title."),
    body: z.string().max(20_000).optional().describe("Note body / content."),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ title, body, tags }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("notes")
      .insert({
        owner_id: ctx.getUserId()!,
        title: title.trim(),
        body: body ?? "",
        tags: tags ?? [],
        source: "mcp",
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Note saved: ${data.id}` }],
      structuredContent: { note: data },
    };
  },
});
