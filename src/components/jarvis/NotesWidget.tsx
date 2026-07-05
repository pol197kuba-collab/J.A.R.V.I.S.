import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Plus, StickyNote } from "lucide-react";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listNotes, createNote, deleteNote } from "@/lib/notes/notes.functions";
import { toast } from "sonner";

export function NotesWidget({ index = 0 }: { index?: number }) {
  const qc = useQueryClient();
  const fetchNotes = useServerFn(listNotes);
  const create = useServerFn(createNote);
  const remove = useServerFn(deleteNote);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes", "list"],
    queryFn: () => fetchNotes(),
    refetchInterval: 8000,
  });

  const createMut = useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      create({ data: { title: input.title, body: input.body, tags: [] } }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["notes", "list"] });
      toast.success("Note saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", "list"] }),
  });

  return (
    <HudPanel
      index={index}
      title="ARCHIVE // NOTES"
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
            placeholder="Note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="font-mono text-xs"
          />
          <Textarea
            placeholder="Body…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!title.trim() || createMut.isPending}
              onClick={() => createMut.mutate({ title: title.trim(), body })}
            >
              {createMut.isPending ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          ▸ loading notes…
        </p>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
          <StickyNote className="h-6 w-6 opacity-40" strokeWidth={1.5} />
          <p className="text-xs">
            No notes yet. Ask J.A.R.V.I.S. to save one, or use <span className="text-primary">NEW</span>.
          </p>
        </div>
      )}

      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {notes.map((n) => (
          <article
            key={n.id}
            className="group border border-primary/20 bg-primary/[0.02] p-3 transition hover:border-primary/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-display truncate text-xs font-semibold uppercase tracking-widest text-foreground">
                  {n.title}
                </h3>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()} · {n.source}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deleteMut.mutate(n.id)}
                aria-label="Delete note"
                className="opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" strokeWidth={1.5} />
              </button>
            </div>
            {n.body && (
              <p className="mt-2 whitespace-pre-wrap break-words text-xs text-foreground/90">
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
          </article>
        ))}
      </div>
    </HudPanel>
  );
}