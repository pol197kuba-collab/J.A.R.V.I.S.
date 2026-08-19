import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Trash2, Pencil, Plus, Check, X, Rocket } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  type Task,
  type TaskStatus,
} from "@/lib/tasks/tasks.functions";
import { listProjects, createProject, deleteProject } from "@/lib/projects/projects.functions";
import { runAgent } from "@/lib/agents/runtime.functions";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const GENERAL_GROUP_KEY = "__general__";
const NO_PROJECT = "__none__";

type TaskGroup = { key: string; label: string; tasks: Task[] };

/** One group per project (alphabetical), plus a trailing "General" group for
 * tasks with no project_id. Projects render as small cards (3-up grid);
 * General keeps the original full-width table — see TasksPage below. */
function groupByProject(tasks: Task[]): TaskGroup[] {
  const byProject = new Map<string, TaskGroup>();
  const general: Task[] = [];

  for (const t of tasks) {
    if (!t.projectId) {
      general.push(t);
      continue;
    }
    const existing = byProject.get(t.projectId);
    if (existing) existing.tasks.push(t);
    else
      byProject.set(t.projectId, {
        key: t.projectId,
        label: t.projectName ?? "Untitled project",
        tasks: [t],
      });
  }

  const groups = [...byProject.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (general.length > 0) groups.push({ key: GENERAL_GROUP_KEY, label: "General", tasks: general });
  return groups;
}

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

/** Small project picker shared by the "new task" form and inline edit —
 * NO_PROJECT maps to null project_id ("General"). */
function ProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string;
  onChange: (v: string) => void;
  projects: { id: string; name: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 min-w-[140px] font-mono text-xs">
        <SelectValue placeholder="Project…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROJECT}>General (no project)</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type EditState = {
  title: string;
  details: string;
  priority: number;
  assigneeSlug: string;
  projectId: string;
};

type EditFormProps = {
  edit: EditState;
  setEdit: (e: EditState) => void;
  projects: { id: string; name: string }[];
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
};

/** Shared inline edit form — used both inside a General table row and
 * inside a compact project card, so the two views stay in sync. */
function TaskEditForm({ edit, setEdit, projects, onSave, onCancel, saving }: EditFormProps) {
  return (
    <div className="flex flex-col gap-2">
      <Input
        value={edit.title}
        onChange={(e) => setEdit({ ...edit, title: e.target.value })}
        maxLength={200}
        className="font-mono text-xs"
        placeholder="Title…"
      />
      <Input
        value={edit.details}
        onChange={(e) => setEdit({ ...edit, details: e.target.value })}
        className="font-mono text-[11px]"
        placeholder="Details (optional)…"
      />
      <div className="flex flex-wrap items-center gap-2">
        <ProjectSelect
          value={edit.projectId}
          onChange={(v) => setEdit({ ...edit, projectId: v })}
          projects={projects}
        />
        <Input
          value={edit.assigneeSlug}
          onChange={(e) => setEdit({ ...edit, assigneeSlug: e.target.value })}
          className="h-8 w-[120px] font-mono text-xs"
          placeholder="assignee slug…"
        />
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setEdit({ ...edit, priority: p })}
              className="font-display h-6 w-6 shrink-0 text-[9px] uppercase tracking-widest transition"
              style={{
                color: edit.priority === p ? priorityColor(p) : "var(--muted-foreground)",
                border: `1px solid ${edit.priority === p ? priorityColor(p) : "color-mix(in oklab, var(--muted-foreground) 40%, transparent)"}`,
                background:
                  edit.priority === p
                    ? "color-mix(in oklab, var(--primary) 10%, transparent)"
                    : "transparent",
              }}
            >
              P{p}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Save"
            disabled={!edit.title.trim() || saving}
            onClick={onSave}
            className="flex items-center gap-1 font-display text-[9px] uppercase tracking-widest text-[color:var(--success)] hover:underline disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} /> save
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="flex items-center gap-1 font-display text-[9px] uppercase tracking-widest text-muted-foreground hover:underline"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} /> cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type RowActions = {
  editingId: string | null;
  edit: EditState | null;
  setEdit: (e: EditState) => void;
  startEdit: (t: Task) => void;
  cancelEdit: () => void;
  saveEdit: (id: string) => void;
  editSaving: boolean;
  onAdvanceDone: (id: string) => void;
  onReopen: (id: string) => void;
  onDelete: (t: Task) => void;
  onRun: (t: Task) => void;
  runningId: string | null;
  projects: { id: string; name: string }[];
};

/** Compact single-task row for a project card — a status dot + title +
 * priority/assignee, expanding into TaskEditForm when being edited. */
function CompactTaskRow({ t, actions }: { t: Task; actions: RowActions }) {
  if (actions.editingId === t.id && actions.edit) {
    return (
      <div className="rounded border border-primary/20 bg-primary/5 p-2">
        <TaskEditForm
          edit={actions.edit}
          setEdit={actions.setEdit}
          projects={actions.projects}
          onSave={() => actions.saveEdit(t.id)}
          onCancel={actions.cancelEdit}
          saving={actions.editSaving}
        />
      </div>
    );
  }
  return (
    <div className="group/task flex items-start gap-2 rounded border border-primary/10 bg-[color:var(--surface-1)]/40 px-2 py-1.5">
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: statusColor[t.status] }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-foreground/90">{t.title}</p>
        <div className="mt-0.5 flex items-center gap-2 font-display text-[8px] uppercase tracking-widest text-muted-foreground">
          <span style={{ color: priorityColor(t.priority) }}>P{t.priority}</span>
          <span className="truncate">{t.assigneeSlug ?? "—"}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition group-hover/task:opacity-100">
        {(t.status === "todo" || t.status === "in_progress") && (
          <button
            type="button"
            aria-label="Mark done"
            onClick={() => actions.onAdvanceDone(t.id)}
            className="font-display text-[8px] uppercase tracking-widest text-[color:var(--success)] hover:underline"
          >
            done
          </button>
        )}
        {(t.status === "done" || t.status === "cancelled") && (
          <button
            type="button"
            aria-label="Reopen"
            onClick={() => actions.onReopen(t.id)}
            className="font-display text-[8px] uppercase tracking-widest text-primary hover:underline"
          >
            reopen
          </button>
        )}
        {(t.status === "todo" || t.status === "in_progress") && (
          <button
            type="button"
            aria-label="Run via J.A.R.V.I.S."
            title="Wypuść do J.A.R.V.I.S."
            disabled={actions.runningId === t.id}
            onClick={() => actions.onRun(t)}
          >
            <Rocket
              className="h-3 w-3 text-muted-foreground hover:text-primary disabled:opacity-40"
              strokeWidth={1.5}
            />
          </button>
        )}
        <button type="button" aria-label="Edit task" onClick={() => actions.startEdit(t)}>
          <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" strokeWidth={1.5} />
        </button>
        <button type="button" aria-label="Delete task" onClick={() => actions.onDelete(t)}>
          <Trash2
            className="h-3 w-3 text-muted-foreground hover:text-destructive"
            strokeWidth={1.5}
          />
        </button>
      </div>
    </div>
  );
}

function TasksPage() {
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const fetchProjects = useServerFn(listProjects);
  const create = useServerFn(createTask);
  const createProj = useServerFn(createProject);
  const removeProject = useServerFn(deleteProject);
  const update = useServerFn(updateTask);
  const remove = useServerFn(deleteTask);
  const runAgentFn = useServerFn(runAgent);
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

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => fetchProjects(),
    refetchInterval: 15000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const invalidateProjects = () => qc.invalidateQueries({ queryKey: ["projects"] });

  const groups = useMemo(() => groupByProject(tasks), [tasks]);
  const projectGroups = useMemo(() => groups.filter((g) => g.key !== GENERAL_GROUP_KEY), [groups]);
  const generalGroup = useMemo(() => groups.find((g) => g.key === GENERAL_GROUP_KEY), [groups]);

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

  // ---------- + New task ----------
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState(3);
  const [newProjectId, setNewProjectId] = useState(NO_PROJECT);

  const createTaskMut = useMutation({
    mutationFn: (input: { title: string; priority: number; projectId?: string }) =>
      create({ data: input }),
    onSuccess: () => {
      setNewTitle("");
      setNewPriority(3);
      setNewProjectId(NO_PROJECT);
      setTaskFormOpen(false);
      invalidate();
      toast.success("Task added");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  // ---------- + New project ----------
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const createProjectMut = useMutation({
    mutationFn: (input: { name: string }) => createProj({ data: input }),
    onSuccess: () => {
      setNewProjectName("");
      setProjectFormOpen(false);
      invalidateProjects();
      toast.success("Project created");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteProjectMut = useMutation({
    mutationFn: (id: string) => removeProject({ data: { id } }),
    onSuccess: () => {
      invalidate();
      invalidateProjects();
      toast.success("Project deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  // ---------- inline edit ----------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  const startEdit = (t: Task) => {
    setEditingId(t.id);
    setEdit({
      title: t.title,
      details: t.details ?? "",
      priority: t.priority,
      assigneeSlug: t.assigneeSlug ?? "",
      projectId: t.projectId ?? NO_PROJECT,
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEdit(null);
  };

  const editMut = useMutation({
    mutationFn: (input: {
      id: string;
      title: string;
      details: string;
      priority: number;
      assigneeSlug: string;
      projectId: string;
    }) =>
      update({
        data: {
          id: input.id,
          title: input.title,
          details: input.details,
          priority: input.priority,
          assigneeSlug: input.assigneeSlug || null,
          projectId: input.projectId === NO_PROJECT ? null : input.projectId,
        },
      }),
    onSuccess: () => {
      invalidate();
      cancelEdit();
      toast.success("Task updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const saveEdit = (id: string) => {
    if (!edit) return;
    editMut.mutate({
      id,
      title: edit.title.trim(),
      details: edit.details.trim(),
      priority: edit.priority,
      assigneeSlug: edit.assigneeSlug.trim(),
      projectId: edit.projectId,
    });
  };

  // ---------- run via JARVIS ----------
  // Hands the task straight to the JARVIS orchestrator as a "do this now"
  // instruction — it looks the task up by title (already unique enough for
  // the model's own list_tasks lookup) and routes it to the right teammate
  // per the existing "WYKONYWANIE ISTNIEJĄCEGO ZADANIA" prompt behavior.
  const [runningId, setRunningId] = useState<string | null>(null);
  const runMut = useMutation({
    mutationFn: (t: Task) => {
      setRunningId(t.id);
      return runAgentFn({
        data: {
          agentSlug: AGENT_SLUGS.JARVIS,
          input: `Wykonaj zadanie: "${t.title}"`,
        },
      });
    },
    onSuccess: (result) => {
      invalidate();
      if (result.status === "done") {
        toast.success(result.output ? result.output.slice(0, 140) : "Zlecono J.A.R.V.I.S.-owi");
      } else {
        toast.error(result.error ?? "Nie udało się zlecić zadania");
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    onSettled: () => setRunningId(null),
  });

  const rowActions: RowActions = {
    editingId,
    edit,
    setEdit,
    startEdit,
    cancelEdit,
    saveEdit,
    editSaving: editMut.isPending,
    onAdvanceDone: (id) => statusMut.mutate({ id, status: "done" }),
    onReopen: (id) => statusMut.mutate({ id, status: "todo" }),
    onDelete: (t) => {
      if (window.confirm(`Delete task "${t.title}"?`)) deleteMut.mutate(t.id);
    },
    onRun: (t) => runMut.mutate(t),
    runningId,
    projects,
  };

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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setProjectFormOpen((v) => !v)}
              className="font-display flex items-center gap-1 text-[10px] uppercase tracking-[0.25em] text-primary/70 hover:text-primary"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              {projectFormOpen ? "close" : "new project"}
            </button>
            <button
              type="button"
              onClick={() => setTaskFormOpen((v) => !v)}
              className="font-display flex items-center gap-1 text-[10px] uppercase tracking-[0.25em] text-primary/70 hover:text-primary"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              {taskFormOpen ? "close" : "new task"}
            </button>
          </div>
        </div>

        {projectFormOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border border-primary/25 bg-primary/[0.03] p-2.5">
            <Input
              placeholder="Project name…"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              maxLength={200}
              className="min-w-[160px] flex-1 font-mono text-xs @max-[420px]:w-full @max-[420px]:flex-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newProjectName.trim() && !createProjectMut.isPending) {
                  createProjectMut.mutate({ name: newProjectName.trim() });
                }
              }}
            />
            <Button
              size="sm"
              disabled={!newProjectName.trim() || createProjectMut.isPending}
              onClick={() => createProjectMut.mutate({ name: newProjectName.trim() })}
            >
              {createProjectMut.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        )}

        {taskFormOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border border-primary/25 bg-primary/[0.03] p-2.5">
            <Input
              placeholder="New task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={200}
              className="min-w-[160px] flex-1 font-mono text-xs @max-[420px]:w-full @max-[420px]:flex-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim() && !createTaskMut.isPending) {
                  createTaskMut.mutate({
                    title: newTitle.trim(),
                    priority: newPriority,
                    projectId: newProjectId === NO_PROJECT ? undefined : newProjectId,
                  });
                }
              }}
            />
            <ProjectSelect value={newProjectId} onChange={setNewProjectId} projects={projects} />
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPriority(p)}
                  className="font-display h-6 w-6 shrink-0 text-[9px] uppercase tracking-widest transition"
                  style={{
                    color: newPriority === p ? priorityColor(p) : "var(--muted-foreground)",
                    border: `1px solid ${newPriority === p ? priorityColor(p) : "color-mix(in oklab, var(--muted-foreground) 40%, transparent)"}`,
                    background:
                      newPriority === p
                        ? "color-mix(in oklab, var(--primary) 10%, transparent)"
                        : "transparent",
                  }}
                >
                  P{p}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={!newTitle.trim() || createTaskMut.isPending}
              onClick={() =>
                createTaskMut.mutate({
                  title: newTitle.trim(),
                  priority: newPriority,
                  projectId: newProjectId === NO_PROJECT ? undefined : newProjectId,
                })
              }
            >
              {createTaskMut.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        )}
      </HudPanel>

      {isLoading && (
        <HudPanel index={1} title="QUEUE // CORE" className="p-4">
          <span className="text-xs text-muted-foreground">▸ loading tasks…</span>
        </HudPanel>
      )}
      {error && (
        <HudPanel index={1} title="QUEUE // CORE" className="p-4">
          <span className="text-xs" style={{ color: "var(--destructive)" }}>
            ✕ task queue unreachable — {error instanceof Error ? error.message : String(error)}
          </span>
        </HudPanel>
      )}
      {!isLoading && !error && tasks.length === 0 && (
        <HudPanel index={1} title="QUEUE // CORE" className="p-4">
          <span className="text-xs text-muted-foreground">
            ▸ nothing here. Ask J.A.R.V.I.S. to create or track a task.
          </span>
        </HudPanel>
      )}

      {/* General: unchanged full-width table for tasks with no project. */}
      {!isLoading && !error && generalGroup && (
        <HudPanel index={1} title="QUEUE // GENERAL" className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px] font-mono text-xs">
              <div className="grid grid-cols-[90px_40px_1fr_120px_130px_120px_60px] gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
                <span>STATUS</span>
                <span>P</span>
                <span>TITLE / DETAILS</span>
                <span>ASSIGNEE</span>
                <span>CREATED BY</span>
                <span>DUE / DONE</span>
                <span />
              </div>

              {generalGroup.tasks.map((t) =>
                editingId === t.id && edit ? (
                  <div
                    key={t.id}
                    className="border-b border-primary/10 bg-primary/5 px-4 py-3 last:border-0"
                  >
                    <TaskEditForm
                      edit={edit}
                      setEdit={setEdit}
                      projects={projects}
                      onSave={() => saveEdit(t.id)}
                      onCancel={cancelEdit}
                      saving={editMut.isPending}
                    />
                  </div>
                ) : (
                  <div
                    key={t.id}
                    className="group grid grid-cols-[90px_40px_1fr_120px_130px_120px_60px] gap-3 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10"
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
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                      {(t.status === "todo" || t.status === "in_progress") && (
                        <button
                          type="button"
                          aria-label="Run via J.A.R.V.I.S."
                          title="Wypuść do J.A.R.V.I.S."
                          disabled={runningId === t.id}
                          onClick={() => runMut.mutate(t)}
                        >
                          <Rocket
                            className="h-3.5 w-3.5 text-muted-foreground hover:text-primary disabled:opacity-40"
                            strokeWidth={1.5}
                          />
                        </button>
                      )}
                      <button type="button" aria-label="Edit task" onClick={() => startEdit(t)}>
                        <Pencil
                          className="h-3.5 w-3.5 text-muted-foreground hover:text-primary"
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
                  </div>
                ),
              )}
            </div>
          </div>
        </HudPanel>
      )}

      {/* Projects: compact cards, up to 3 per row. */}
      {!isLoading && !error && projectGroups.length > 0 && (
        <div className="grid grid-cols-1 gap-4 @[680px]:grid-cols-2 @[1020px]:grid-cols-3">
          {projectGroups.map((g, i) => (
            <HudPanel
              key={g.key}
              index={i + 2}
              title={`PROJECT // ${g.label.toUpperCase()}`}
              className="p-3"
              rightSlot={
                <button
                  type="button"
                  aria-label={`Delete project ${g.label}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete project "${g.label}"? Its ${g.tasks.length} task(s) will move to General, not be deleted.`,
                      )
                    ) {
                      deleteProjectMut.mutate(g.key);
                    }
                  }}
                >
                  <Trash2
                    className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                    strokeWidth={1.5}
                  />
                </button>
              }
            >
              <div className="no-scrollbar flex max-h-80 min-h-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
                {g.tasks.map((t) => (
                  <CompactTaskRow key={t.id} t={t} actions={rowActions} />
                ))}
              </div>
            </HudPanel>
          ))}
        </div>
      )}
    </div>
  );
}
