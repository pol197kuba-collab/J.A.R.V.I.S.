// Shared helper for the one thing almost every server function's error
// branch was missing: a trace left in public.system_events so Strażnik
// (Guardian) can actually see it. guardian_scan_errors scans this table
// for `level IN ('warn','error')` across every `source` with no filter —
// so any call site using this helper is picked up automatically, no
// Guardian-side changes needed.
//
// Deliberately a plain function, not a generic .handler()-wrapping HOC —
// this project's server-function type inference (createServerFn +
// .middleware + .inputValidator + .handler chaining) is finicky enough
// that a generic wrapper risks breaking inference in ways that can't be
// verified without a working `tsc` in every environment this ships from.
// Explicit call sites are more repetitive but safe.
//
// Safe to import at the top level of a *.functions.ts file (which ships
// to the client bundle): takes an already-authenticated SupabaseClient as
// a parameter rather than constructing one, touches no server secrets,
// and is never called from client code in practice (every call site is
// inside a createServerFn .handler() body).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export async function logServerError(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: string,
  error: unknown,
  meta?: Json,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await supabase.from("system_events").insert({
    owner_id: userId,
    level: "error",
    source,
    message,
    meta: meta ?? null,
  });
}

export async function logServerWarn(
  supabase: SupabaseClient<Database>,
  userId: string,
  source: string,
  message: string,
  meta?: Json,
): Promise<void> {
  await supabase.from("system_events").insert({
    owner_id: userId,
    level: "warn",
    source,
    message,
    meta: meta ?? null,
  });
}
