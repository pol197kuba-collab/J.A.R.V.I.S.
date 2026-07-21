import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { supabase } from "@/integrations/supabase/client";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  createDocumentFn,
  deleteDocumentFn,
  listDocumentsFn,
  processDocumentFn,
  type DocumentSummary,
} from "@/lib/documents/documents.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "JARVIS // Documents" },
      {
        name: "description",
        content: "Upload and manage documents grounding the Analityk agent's RAG search.",
      },
    ],
  }),
  component: DocumentsPage,
});

const STATUS_COLOR: Record<string, string> = {
  uploading: "var(--muted-foreground)",
  processing: "var(--primary)",
  ready: "var(--success)",
  error: "var(--destructive)",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsPage() {
  const qc = useQueryClient();
  const fetchDocuments = useServerFn(listDocumentsFn);
  const create = useServerFn(createDocumentFn);
  const process = useServerFn(processDocumentFn);
  const remove = useServerFn(deleteDocumentFn);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const {
    data: documents = [],
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["documents"],
    queryFn: () => fetchDocuments(),
    // Fast enough to reflect uploading -> processing -> ready without
    // feeling laggy; this is a small owner-scoped table, not a
    // rate-limited third-party API, so a flat interval is fine.
    refetchInterval: 3000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["documents"] });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { documentId: id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Dokument usunięty");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setUploading(true);
    try {
      const created = await create({
        data: {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      });
      if (!created.ok) {
        const msg =
          created.reason === "unsupported_type"
            ? `Nieobsługiwany format — dozwolone: ${ALLOWED_EXTENSIONS.join(", ")}`
            : created.reason === "too_large"
              ? `Plik za duży (limit ${formatBytes(MAX_FILE_SIZE_BYTES)})`
              : `Błąd: ${created.message ?? created.reason}`;
        toast.error(msg);
        return;
      }

      const { error: uploadErr } = await supabase.storage
        .from(created.bucket)
        .upload(created.storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (uploadErr) {
        toast.error(`Upload nieudany: ${uploadErr.message}`);
        return;
      }
      invalidate();

      const result = await process({ data: { documentId: created.documentId } });
      if (!result.ok) {
        toast.error(`Przetwarzanie nieudane: ${result.reason}`);
      } else {
        toast.success(`Gotowe — ${result.chunkCount} fragmentów, ${result.embeddedCount} zaindeksowanych`);
      }
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="ANALITYK // DOCUMENT ARCHIVE" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">DOCUMENTS</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(",")}
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "font-display inline-flex items-center gap-2 border border-primary/50 bg-primary/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/15",
              uploading && "cursor-not-allowed opacity-50",
            )}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            {uploading ? "Przesyłanie…" : "Prześlij dokument"}
          </button>
          <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {documents.length} DOCS {isFetching ? "// syncing…" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {ALLOWED_EXTENSIONS.join(" / ")} · max {formatBytes(MAX_FILE_SIZE_BYTES)}
          </span>
        </div>
      </HudPanel>

      <HudPanel index={1} title="ARCHIVE // INDEX" className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[760px] font-mono text-xs">
            <div className="grid grid-cols-[110px_1fr_100px_90px_100px_150px_40px] gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
              <span>STATUS</span>
              <span>FILENAME</span>
              <span>SIZE</span>
              <span>CHUNKS</span>
              <span>CHARS</span>
              <span>UPLOADED</span>
              <span />
            </div>

            {isLoading && <div className="px-4 py-3 text-muted-foreground">▸ loading archive…</div>}
            {error && (
              <div className="px-4 py-3" style={{ color: "var(--destructive)" }}>
                ✕ archive unreachable — {error instanceof Error ? error.message : String(error)}
              </div>
            )}
            {!isLoading && !error && documents.length === 0 && (
              <div className="px-4 py-6 text-center text-muted-foreground">
                ▸ brak dokumentów. Prześlij plik, aby Analityk mógł go przeszukiwać.
              </div>
            )}

            {documents.map((d: DocumentSummary) => (
              <div
                key={d.id}
                className="group grid grid-cols-[110px_1fr_100px_90px_100px_150px_40px] items-center gap-3 border-b border-primary/10 px-4 py-2 last:border-0 hover:bg-primary/10"
              >
                <span
                  className="font-display tracking-widest"
                  style={{ color: STATUS_COLOR[d.status] ?? "var(--muted-foreground)" }}
                >
                  ▸ {d.status}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-foreground">{d.filename}</p>
                  {d.status === "error" && d.error_message && (
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--destructive)" }}>
                      {d.error_message}
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground">{formatBytes(d.size_bytes)}</span>
                <span className="text-muted-foreground">{d.chunk_count ?? "—"}</span>
                <span className="text-muted-foreground">{d.char_count ?? "—"}</span>
                <span className="truncate text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}
                </span>
                <button
                  type="button"
                  aria-label="Delete document"
                  className="opacity-0 transition group-hover:opacity-100"
                  onClick={() => {
                    if (window.confirm(`Usunąć dokument "${d.filename}"?`)) deleteMut.mutate(d.id);
                  }}
                >
                  <Trash2
                    className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
