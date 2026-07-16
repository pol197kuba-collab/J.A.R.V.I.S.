import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Plus, ListChecks, X, Bot } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/tasks/tasks.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// P1-P2 read as "urgent" (amber); P3-P5 stay neutral primary.
function priorityStyle(p: number): { label: string; color: string } {
  if (p <= 2) return { label: `P${p}`, color: "var(--warning)" };
  return { label: `P${p}`, color: "var(--primary)" };
}

export function TasksWidget({ index = 0 }: { index?: number }) {
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const remove = useServerFn(deleteTask);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState(3);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: () => fetchTasks({ data: { scope: "open" } }),
    refetchInterval: 8000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });

  const createMut = useMutation({
    mutationFn: (input: { title: string; details: string; priority: number }) =>
      create({ data: { title: input.title, details: input.details, priority: input.priority } }),
    onSuccess: () => {
      setTitle("");
      setDetails("");
      setPriority(3);
      setOpen(false);
      invalidate();
      toast.success("Task created");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const statusMut = useMutation({
    mutationFn: (input: { id: string; status: "done" | "cancelled" | "in_progress" }) =>
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
    <HudPanel
      index={index}
      tone="quiet"
      title="OPS // TASK QUEUE"
      rightSlot={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="font-display flex items-center gap-1 border border-primary/60 bg-primary/5 px-2 py-1 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/15 hover:text-foreground"
        >
          <Plus className="h-3 w-3" strokeWidth={1.75} />
          {open ? "close" : "new"}
        </button>
      }
      className="p-4"
    >
      {open && (
        <div className="mb-3 space-y-2 border border-primary/25 bg-primary/[0.03] p-3">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="font-mono text-xs"
          />
          <Textarea
            placeholder="Details (optional)…"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "font-display border px-1.5 py-0.5 text-[10px] uppercase tracking-widest transition",
                    priority === p
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-primary/25 text-muted-foreground hover:border-primary/60",
                  )}
                >
                  P{p}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={!title.trim() || createMut.isPending}
              onClick={() =>
                createMut.mutate({ title: title.trim(), details: details.trim(), priority })
              }
            >
              {createMut.isPending ? "Saving…" : "Add task"}
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          ▸ loading tasks…
        </p>
      )}

      {!isLoading && tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
          <ListChecks className="h-6 w-6 opacity-40" strokeWidth={1.5} />
          <p className="text-xs">
            No open tasks. Ask J.A.R.V.I.S. to track something, or use{" "}
            <span className="text-primary">NEW</span>.
          </p>
        </div>
      )}

      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {tasks.map((t) => {
          const pr = priorityStyle(t.priority);
          return (
            <article
              key={t.id}
              className="group flex items-start gap-3 border border-primary/20 bg-primary/[0.02] p-3 transition hover:border-primary/50"
            >
              <button
                type="button"
                aria-label="Mark task done"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate({ id: t.id, status: "done" })}
                className="mt-0.5 h-4 w-4 shrink-0 border border-primary/50 transition hover:border-primary hover:bg-primary/20"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="font-display shrink-0 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: pr.color }}
                  >
                    {pr.label}
                  </span>
                  <h3 className="truncate text-xs font-medium text-foreground">{t.title}</h3>
                  {t.status === "in_progress" && (
                    <span className="font-display shrink-0 text-[9px] uppercase tracking-widest text-primary/70">
                      · active
                    </span>
                  )}
                </div>
                {t.details && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground/80">
                    {t.details}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  {t.createdByAgent && (
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3" strokeWidth={1.5} /> {t.createdByAgent}
                    </span>
                  )}
                  {t.assigneeSlug && <span>→ {t.assigneeSlug}</span>}
                  {t.dueAt && <span>due {new Date(t.dueAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Cancel task"
                  onClick={() => statusMut.mutate({ id: t.id, status: "cancelled" })}
                >
                  <X
                    className="h-3.5 w-3.5 text-muted-foreground hover:text-[color:var(--warning)]"
                    strokeWidth={1.5}
                  />
                </button>
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
            </article>
          );
        })}
      </div>
    </HudPanel>
  );
}
