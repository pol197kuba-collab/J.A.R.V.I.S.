import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Plus, StickyNote, Pencil, Check, X, Search } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listNotes,
  createNote,
  deleteNote,
  updateNote,
  type Note,
} from "@/lib/notes/notes.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { title: "JARVIS // Notes" },
      { name: "description", content: "Personal notes archive — saved by you or by J.A.R.V.I.S." },
    ],
  }),
  component: NotesPage,
});

function NotesPage() {
  const qc = useQueryClient();
  const fetchNotes = useServerFn(listNotes);
  const create = useServerFn(createNote);
  const remove = useServerFn(deleteNote);
  const update = useServerFn(updateNote);

  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const {
    data: notes = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["notes", "list"],
    queryFn: () => fetchNotes(),
    refetchInterval: 8000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notes", "list"] });

  const createMut = useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      create({ data: { title: input.title, body: input.body, tags: [] } }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setOpen(false);
      invalidate();
      toast.success("Notatka zapisana");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Notatka usunięta");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: string; title: string; body: string }) => update({ data: input }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Notatka zaktualizowana");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  function startEdit(n: Note) {
    setEditingId(n.id);
    setEditTitle(n.title);
    setEditBody(n.body ?? "");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [notes, search]);

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="ARCHIVE // NOTES" className="p-5">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold tracking-[0.18em]">NOTES</h1>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-display flex items-center gap-1 border border-primary/60 bg-primary/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/15 hover:text-foreground"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            {open ? "zamknij" : "nowa notatka"}
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Szukaj w tytule, treści, tagach…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 font-mono text-xs"
          />
        </div>

        {open && (
          <div className="mt-3 space-y-2 border border-primary/25 bg-primary/[0.03] p-3">
            <Input
              placeholder="Tytuł notatki"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="font-mono text-xs"
            />
            <Textarea
              placeholder="Treść…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!title.trim() || createMut.isPending}
                onClick={() => createMut.mutate({ title: title.trim(), body })}
              >
                {createMut.isPending ? "Zapisuję…" : "Zapisz notatkę"}
              </Button>
            </div>
          </div>
        )}
      </HudPanel>

      <HudPanel
        index={1}
        tone="quiet"
        title="LISTA"
        rightSlot={
          <span className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            {filtered.length} {isFetching && !isLoading ? "· odświeżanie…" : ""}
          </span>
        }
        className="p-4"
      >
        {isLoading && (
          <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            ▸ ładowanie notatek…
          </p>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <StickyNote className="h-6 w-6 opacity-40" strokeWidth={1.5} />
            <p className="text-xs">
              {notes.length === 0
                ? "Brak notatek. Poproś J.A.R.V.I.S.a o zapisanie jednej albo użyj przycisku powyżej."
                : "Nic nie pasuje do wyszukiwania."}
            </p>
          </div>
        )}

        <div className="no-scrollbar grid max-h-[65vh] min-h-0 grid-cols-1 gap-2 overflow-y-auto overflow-x-hidden pr-1 md:grid-cols-2">
          {filtered.map((n) => (
            <article
              key={n.id}
              className="group min-w-0 border border-primary/20 bg-primary/[0.02] p-3 transition hover:border-primary/50"
            >
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={200}
                    className="font-mono text-xs"
                  />
                  <Textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={updateMut.isPending}
                    >
                      <X className="mr-1 h-3 w-3" /> Anuluj
                    </Button>
                    <Button
                      size="sm"
                      disabled={!editTitle.trim() || updateMut.isPending}
                      onClick={() =>
                        updateMut.mutate({ id: n.id, title: editTitle.trim(), body: editBody })
                      }
                    >
                      <Check className="mr-1 h-3 w-3" />
                      {updateMut.isPending ? "Zapisuję…" : "Zapisz"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display truncate text-xs font-semibold uppercase tracking-widest text-foreground">
                        {n.title}
                      </h3>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString()} · {n.source}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(n)}
                        aria-label="Edytuj notatkę"
                      >
                        <Pencil
                          className="h-3.5 w-3.5 text-muted-foreground hover:text-primary"
                          strokeWidth={1.5}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Usunąć notatkę "${n.title}"?`))
                            deleteMut.mutate(n.id);
                        }}
                        aria-label="Usuń notatkę"
                      >
                        <Trash2
                          className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                          strokeWidth={1.5}
                        />
                      </button>
                    </div>
                  </div>
                  {n.body && (
                    <p className="mt-2 min-w-0 whitespace-pre-wrap break-words text-xs text-foreground/90">
                      {n.body}
                    </p>
                  )}
                  {n.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {n.tags.map((t) => (
                        <span
                          key={t}
                          className="border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-widest text-primary/80"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}
