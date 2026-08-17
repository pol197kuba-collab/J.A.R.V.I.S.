// Kanban-style task board — the seed of the future "task queue for agents"
// system. Reuses the existing tasks table/server functions (already modeled
// with assignee_slug + status + priority, effectively "Jira for agents"
// schema already) — this just gives it a board instead of a flat list. The
// full-featured /tasks page (filters, archive) stays as the deep-dive view;
// this is the at-a-glance summary that belongs on the command dashboard.
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { useHudNavigate } from "./TransitionContext";
import { listTasks, updateTask, type Task, type TaskStatus } from "@/lib/tasks/tasks.functions";
import { toast } from "sonner";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "todo", label: "DO ZROBIENIA", color: "var(--muted-foreground)" },
  { status: "in_progress", label: "W TOKU", color: "var(--primary)" },
  { status: "done", label: "GOTOWE", color: "var(--success)" },
  { status: "cancelled", label: "ANULOWANE", color: "var(--warning)" },
];

// Next status a single click advances a card to — todo → in_progress → done.
// Cancelled/done cards get no forward action (dead ends by design); use the
// full /tasks page to reopen or delete.
const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: "in_progress",
  in_progress: "done",
};

function priorityColor(p: number): string {
  return p <= 2 ? "var(--warning)" : "var(--muted-foreground)";
}

function TaskCard({ task, onAdvance }: { task: Task; onAdvance: (id: string) => void }) {
  const next = NEXT_STATUS[task.status];
  return (
    <div className="min-w-0 rounded border border-primary/15 bg-[color:var(--surface-1)]/60 p-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 break-words font-mono text-[11px] leading-snug text-foreground/90">
          {task.title}
        </p>
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 font-display text-[8px] uppercase tracking-widest"
          style={{
            color: priorityColor(task.priority),
            border: `1px solid ${priorityColor(task.priority)}`,
          }}
        >
          P{task.priority}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate font-display text-[9px] uppercase tracking-[0.15em] text-primary/70">
          {task.assigneeSlug ?? "—"}
        </span>
        {next && (
          <button
            type="button"
            onClick={() => onAdvance(task.id)}
            className="shrink-0 font-display text-[8px] uppercase tracking-widest text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            → {next === "in_progress" ? "start" : "zakończ"}
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskBoardPanel({ index = 0 }: { index?: number }) {
  const { go } = useHudNavigate();
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const update = useServerFn(updateTask);

  const { data: tasks = [], isFetching } = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: () => fetchTasks({ data: { scope: "all" } }),
    refetchInterval: 10_000,
  });

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of tasks) map.get(t.status)?.push(t);
    return map;
  }, [tasks]);

  const advanceMut = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus }) =>
      update({ data: { id: input.id, status: input.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <HudPanel
      index={index}
      tone="quiet"
      title="TASK BOARD // AGENT QUEUE"
      rightSlot={
        <button
          type="button"
          onClick={() => go("/tasks")}
          className="font-display text-[10px] uppercase tracking-[0.25em] text-primary/70 hover:text-primary"
        >
          pełny widok →
        </button>
      }
      className="p-4"
    >
      {isFetching && tasks.length === 0 ? (
        <p className="mt-2 font-display text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          ▸ Ładowanie zadań…
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byStatus.get(col.status) ?? [];
            return (
              <div key={col.status} className="flex min-h-0 flex-col">
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className="font-display text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: col.color }}
                  >
                    {col.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="no-scrollbar flex max-h-72 min-h-[3rem] flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
                  {items.length === 0 ? (
                    <p className="font-mono text-[9px] text-muted-foreground/60">brak</p>
                  ) : (
                    items.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onAdvance={(id) => {
                          const nextStatus = NEXT_STATUS[t.status];
                          if (nextStatus) advanceMut.mutate({ id, status: nextStatus });
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}
