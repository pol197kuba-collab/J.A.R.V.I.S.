// Projects — CRUD server functions for the /tasks page's manual project
// management (create + list for the task-form dropdown). The agent-facing
// list_projects/create_project tools in tools.server.ts do the same DB work
// for the agent runtime; this is the client-callable counterpart so a human
// can manage projects directly instead of only through chat.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { logServerError } from "@/lib/system/logServerError";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  repoOwner: string | null;
  repoName: string | null;
  status: string;
};

const SELECT = "id, name, description, repo_owner, repo_name, status";

type Row = {
  id: string;
  name: string;
  description: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  status: string;
};

function mapRow(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    repoOwner: r.repo_owner,
    repoName: r.repo_name,
    status: r.status,
  };
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Project[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("projects")
      .select(SELECT)
      .eq("owner_id", userId)
      .order("name", { ascending: true });
    if (error) {
      await logServerError(supabase, userId, "projects.list", error);
      throw new Error(error.message);
    }
    return ((data as Row[] | null) ?? []).map(mapRow);
  });

const CreateInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<Project> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .insert({
        owner_id: userId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
      })
      .select(SELECT)
      .single();
    if (error) {
      await logServerError(supabase, userId, "projects.create", error, {
        name: data.name,
      } as Json);
      throw new Error(
        error.code === "23505" ? "Projekt o tej nazwie już istnieje." : error.message,
      );
    }
    return mapRow(row as Row);
  });
