// Notes — CRUD server functions for the personal notes widget.
// Notes are user-scoped (RLS in DB); the same table is written by the
// orchestrator's `save_note` tool.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
};

export const listNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Note[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("notes")
      .select("id, title, body, tags, source, created_at, updated_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags ?? [],
      source: n.source,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
  });

const CreateInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional().default(""),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
});

export const createNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<Note> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("notes")
      .insert({
        owner_id: userId,
        title: data.title.trim(),
        body: data.body,
        tags: data.tags,
        source: "manual",
      })
      .select("id, title, body, tags, source, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      tags: row.tags ?? [],
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("owner_id", userId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional().default(""),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const updateNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }): Promise<Note> => {
    const { supabase, userId } = context;
    const patch = {
      title: data.title.trim(),
      body: data.body,
      updated_at: new Date().toISOString(),
      ...(data.tags ? { tags: data.tags } : {}),
    };
    const { data: row, error } = await supabase
      .from("notes")
      .update(patch)
      .eq("owner_id", userId)
      .eq("id", data.id)
      .select("id, title, body, tags, source, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      tags: row.tags ?? [],
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });