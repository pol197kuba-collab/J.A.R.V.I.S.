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
  name: "create_task",
  title: "Create task",
  description: "Create a new task for the signed-in user.",
  inputSchema: {
    title: z.string().min(1).max(200).describe("Short task title."),
    details: z.string().max(4000).optional().describe("Optional longer description."),
    priority: z.number().int().min(0).max(5).optional().describe("Priority 0-5 (default 2)."),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ title, details, priority, tags }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("tasks")
      .insert({
        user_id: ctx.getUserId()!,
        title: title.trim(),
        details: details ?? null,
        priority: priority ?? 2,
        tags: tags ?? [],
        status: "todo",
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Task created: ${data.id}` }],
      structuredContent: { task: data },
    };
  },
});