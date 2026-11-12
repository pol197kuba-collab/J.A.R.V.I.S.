// Narzędzia agentów — local. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Tool } from "./shared.server";

// ---------------------------------------------------------------------------
// run_local_action — bridge to the local worker (local-worker/worker.py)
// ---------------------------------------------------------------------------

// This is the ONE tool in the catalog whose execute() never touches the
// resource itself — it can't: the server process running this code has no
// access to the user's actual filesystem. Instead it drops a row in
// public.local_jobs (owner-scoped, RLS-protected — see the migration) and
// polls for the local worker to pick it up and report back. The worker
// authenticates as the same Supabase user (not service role), so it can
// only ever see its own owner's jobs, exactly like the browser.
const LOCAL_JOB_POLL_INTERVAL_MS = 500;
const LOCAL_JOB_TIMEOUT_MS = 20_000;
const LOCAL_JOB_ACTIONS = ["list_dir", "read_text_file", "write_text_file"] as const;

export const runLocalAction: Tool = {
  // Zapis na dysku jest nieodwracalny; nieznana akcja liczy się jak zapis.
  risk: (args) =>
    args.action === "list_dir" || args.action === "read_text_file" ? "read" : "external",
  // Nazwy i treść plików z dysku to obca treść.
  untrustedOutput: (args) => args.action === "list_dir" || args.action === "read_text_file",
  declaration: {
    name: "run_local_action",
    description:
      "Zleć akcję na plikach lokalnego komputera użytkownika — jego prawdziwym dysku, nie chmurze. Wymaga uruchomionego lokalnego workera (local-worker/worker.py); jeśli go nie ma, zwróci błąd 'worker_offline' po ok. 20s — poinformuj wtedy użytkownika, że worker nie odpowiada. Akcje: list_dir (lista plików w katalogu), read_text_file (odczyt pliku tekstowego), write_text_file (zapis/nadpisanie pliku tekstowego, wymaga 'content'). Ścieżki są względne wobec katalogu roboczego skonfigurowanego na komputerze użytkownika — nie podawaj ścieżek bezwzględnych spoza niego.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...LOCAL_JOB_ACTIONS],
          description: "Która akcja lokalna ma zostać wykonana.",
        },
        path: {
          type: "string",
          description: "Ścieżka pliku/katalogu względem lokalnego katalogu roboczego workera.",
        },
        content: {
          type: "string",
          description: "Treść do zapisania — wymagane tylko dla write_text_file.",
        },
      },
      required: ["action", "path"],
    },
  },
  async execute(args, ctx) {
    const action = String(args.action ?? "");
    if (!(LOCAL_JOB_ACTIONS as readonly string[]).includes(action)) {
      return { error: "invalid_action", requested: action };
    }
    const path = String(args.path ?? "").trim();
    if (!path) return { error: "missing_path" };
    if (action === "write_text_file" && typeof args.content !== "string") {
      return { error: "missing_content" };
    }

    const { data: job, error: insertErr } = await ctx.supabase
      .from("local_jobs")
      .insert({
        owner_id: ctx.userId,
        type: action,
        args: { path, ...(action === "write_text_file" ? { content: String(args.content) } : {}) },
      })
      .select("id")
      .single();
    if (insertErr) {
      await ctx.logEvent("error", "tool.run_local_action", insertErr.message, { action, path });
      return { error: insertErr.message };
    }

    const deadline = Date.now() + LOCAL_JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LOCAL_JOB_POLL_INTERVAL_MS));
      const { data: row, error: pollErr } = await ctx.supabase
        .from("local_jobs")
        .select("status, result, error")
        .eq("id", job.id)
        .single();
      if (pollErr) {
        await ctx.logEvent("error", "tool.run_local_action", pollErr.message, {
          job_id: job.id,
        });
        return { error: pollErr.message };
      }
      if (row.status === "done") {
        await ctx.logEvent("info", "tool.run_local_action", `${action} ${path} → done`, {
          job_id: job.id,
        });
        return { ok: true, result: row.result };
      }
      if (row.status === "error") {
        await ctx.logEvent("warn", "tool.run_local_action", `${action} ${path} → ${row.error}`, {
          job_id: job.id,
        });
        return { error: row.error ?? "local_action_failed" };
      }
    }

    await ctx.logEvent("warn", "tool.run_local_action", `${action} ${path} → timed out`, {
      job_id: job.id,
    });
    return {
      error: "worker_offline",
      note: "Lokalny worker nie odebrał zadania w 20s — sprawdź, czy local-worker/worker.py jest uruchomiony na komputerze użytkownika.",
    };
  },
};
