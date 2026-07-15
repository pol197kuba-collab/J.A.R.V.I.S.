import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Trash2 } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { listTasks, updateTask, deleteTask, type TaskStatus } from "@/lib/tasks/tasks.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "JARVIS // Tasks" },
      { name: "description", content: "Task control — the queue JARVIS agents create and drive." },
    ],
  }),
  component: TasksPage,
});

type Scope = "open" | "archive" | "all";
const SCOPES: { id: Scope; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "archive", label: "Archive" },
  { id: "all", label: "All" },
];

const statusColor: Record<TaskStatus, string> = {
  todo: "var(--muted-foreground)",
  in_progress: "var(--primary)",
  done: "var(--success)",
  cancelled: "var(--warning)",
};

function priorityColor(p: number): string {
  return p <= 2 ? "var(--warning)" : "var(--primary)";
}

function TasksPage() {
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const update = useServerFn(updateTask);
  const remove = useServerFn(deleteTask);
  const [scope, setScope] = useState<Scope>("open");

  const {
    data: tasks = [],
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["tasks", scope],
    queryFn: () => fetchTasks({ data: { scope } }),
    refetchInterval: 8000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });

  const statusMut = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus }) =>
      update({ data: { id: input.id, status: input.status } }),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Task deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="OPS // TASK CONTROL" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">TASKS</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={cn(
                "font-display border px-3 py-1 text-[10px] uppercase tracking-widest transition",
                scope === s.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-primary/40 text-muted-foreground hover:bg-primary/10",
              )}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {tasks.length} TASKS {isFetching ? "// syncing…" : ""}
          </span>
        </div>
      </HudPanel>

      <HudPanel index={1} title="QUEUE // CORE" className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[860px] font-mono text-xs">
            <div className="grid grid-cols-[90px_40px_1fr_120px_130px_120px] gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
              <span>STATUS</span>
              <span>P</span>
              <span>TITLE / DETAILS</span>
              <span>ASSIGNEE</span>
              <span>CREATED BY</span>
              <span>DUE / DONE</span>
            </div>

            {isLoading && <div className="px-4 py-3 text-muted-foreground">▸ loading tasks…</div>}
            {error && (
              <div className="px-4 py-3" style={{ color: "var(--destructive)" }}>
                ✕ task queue unreachable — {error instanceof Error ? error.message : String(error)}
              </div>
            )}
            {!isLoading && !error && tasks.length === 0 && (
              <div className="px-4 py-6 text-center text-muted-foreground">
                ▸ nothing here. Ask J.A.R.V.I.S. to create or track a task.
              </div>
            )}

            {tasks.map((t) => (
              <div
                key={t.id}
                className="group grid grid-cols-[90px_40px_1fr_120px_130px_120px] gap-3 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10"
              >
                <span
                  className="font-display tracking-widest"
                  style={{ color: statusColor[t.status] }}
                >
                  ▸ {t.status.replace("_", " ")}
                </span>
                <span
                  className="font-display font-semibold"
                  style={{ color: priorityColor(t.priority) }}
                >
                  P{t.priority}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-foreground">{t.title}</p>
                  {t.details && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                      {t.details}
                    </p>
                  )}
                  {t.result && (
                    <p className="mt-0.5 text-[11px] text-[color:var(--success)]/80">
                      → {t.result}
                    </p>
                  )}
                </div>
                <span className="truncate text-muted-foreground">{t.assigneeSlug ?? "—"}</span>
                <span className="flex items-center gap-1 truncate text-muted-foreground">
                  {t.createdByAgent ? (
                    <>
                      <Bot className="h-3 w-3 shrink-0" strokeWidth={1.5} /> {t.createdByAgent}
                    </>
                  ) : (
                    "manual"
                  )}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t.status === "done" || t.status === "cancelled"
                      ? t.completedAt
                        ? new Date(t.completedAt).toLocaleDateString()
                        : "—"
                      : t.dueAt
                        ? new Date(t.dueAt).toLocaleDateString()
                        : "—"}
                  </span>
                  <div className="flex shrink-0 items-center gap-2 opacity-0 transition group-hover:opacity-100">
                    {(t.status === "todo" || t.status === "in_progress") && (
                      <button
                        type="button"
                        onClick={() => statusMut.mutate({ id: t.id, status: "done" })}
                        className="font-display text-[9px] uppercase tracking-widest text-[color:var(--success)] hover:underline"
                      >
                        done
                      </button>
                    )}
                    {(t.status === "done" || t.status === "cancelled") && (
                      <button
                        type="button"
                        onClick={() => statusMut.mutate({ id: t.id, status: "todo" })}
                        className="font-display text-[9px] uppercase tracking-widest text-primary hover:underline"
                      >
                        reopen
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Delete task"
                      onClick={() => {
                        if (window.confirm(`Delete task "${t.title}"?`)) deleteMut.mutate(t.id);
                      }}
                    >
                      <Trash2
                        className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                        strokeWidth={1.5}
                      />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
