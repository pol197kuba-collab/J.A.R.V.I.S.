import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, FileText, Presentation, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { HudPanel } from "@/components/jarvis/HudPanel";
import { GeneratedFilePreview } from "@/components/jarvis/GeneratedFilePreview";
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
import {
  deleteGeneratedFileFn,
  listGeneratedFilesFn,
  type GeneratedFileSummary,
} from "@/lib/documents/generated.functions";
import { consumePendingOpenDocument, onOpenDocument } from "@/lib/documents/openDocumentBus";
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

const FORMAT_ICON: Record<string, typeof FileText> = {
  pptx: Presentation,
  docx: FileText,
  pdf: FileText,
};

function DocumentsPage() {
  const qc = useQueryClient();
  const fetchDocuments = useServerFn(listDocumentsFn);
  const create = useServerFn(createDocumentFn);
  const process = useServerFn(processDocumentFn);
  const remove = useServerFn(deleteDocumentFn);

  const fetchGenerated = useServerFn(listGeneratedFilesFn);
  const removeGenerated = useServerFn(deleteGeneratedFileFn);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<GeneratedFileSummary | null>(null);
  // A file id requested by chat/voice ("otwórz prezentację o X") that we
  // must open once the generated-files list has loaded and contains it.
  const pendingOpenRef = useRef<string | null>(consumePendingOpenDocument());

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

  const {
    data: generated = [],
    isLoading: genLoading,
    error: genError,
  } = useQuery({
    queryKey: ["generated-files"],
    queryFn: () => fetchGenerated(),
    refetchInterval: 5000,
  });

  // Chat/voice "open this file" requests arriving while we're already mounted.
  useEffect(() => onOpenDocument((id) => (pendingOpenRef.current = id)), []);

  // Once a pending id is set (from navigation or a live event) and the list
  // contains it, open that file's preview. Runs whenever the list changes so
  // it fires as soon as the target file is present.
  useEffect(() => {
    const id = pendingOpenRef.current;
    if (!id) return;
    const match = generated.find((f) => f.id === id);
    if (match) {
      pendingOpenRef.current = null;
      setPreview(match);
    }
  }, [generated]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["documents"] });

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { documentId: id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Dokument usunięty");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteGenMut = useMutation({
    mutationFn: (id: string) => removeGenerated({ data: { fileId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generated-files"] });
      toast.success("Plik usunięty");
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
        toast.success(
          `Gotowe — ${result.chunkCount} fragmentów, ${result.embeddedCount} zaindeksowanych`,
        );
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
                    <p
                      className="mt-0.5 truncate text-[11px]"
                      style={{ color: "var(--destructive)" }}
                    >
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

      <HudPanel index={2} title="PRODUCER // GENERATED" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="font-display text-sm font-bold tracking-[0.18em] text-primary">
            WYGENEROWANE PLIKI
          </h2>
          <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            {generated.length} FILES
          </span>
        </div>
        <p className="px-4 pb-3 pt-1 text-[11px] text-muted-foreground">
          Prezentacje, dokumenty i PDF-y stworzone przez agenta Producer. Kliknij, aby podejrzeć bez
          pobierania.
        </p>

        {genLoading && <div className="px-4 py-3 text-muted-foreground">▸ loading…</div>}
        {genError && (
          <div className="px-4 py-3" style={{ color: "var(--destructive)" }}>
            ✕ {genError instanceof Error ? genError.message : String(genError)}
          </div>
        )}
        {!genLoading && !genError && generated.length === 0 && (
          <div className="px-4 py-6 text-center text-muted-foreground">
            ▸ brak plików. Poproś JARVIS-a, np. „zrób mi prezentację o…", aby Producer coś stworzył.
          </div>
        )}

        {generated.length > 0 && (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {generated.map((f: GeneratedFileSummary) => {
              const Icon = FORMAT_ICON[f.format] ?? FileText;
              return (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setPreview(f)}
                  className="group relative flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/[0.03] p-3 text-left transition hover:border-primary/50 hover:bg-primary/10"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
                    <span className="font-display text-[10px] uppercase tracking-widest text-primary/80">
                      {f.format}
                    </span>
                    {f.image_status === "pending" && (
                      <span className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-primary/70">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        grafiki w toku
                      </span>
                    )}
                    {f.image_status === "failed" && (
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "var(--destructive)" }}
                        title="Nie udało się wygenerować grafik (model przeciążony) — plik jest gotowy bez nich."
                      >
                        grafiki niedostępne
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground opacity-0 transition group-hover:opacity-100">
                      <Eye className="h-3 w-3" strokeWidth={1.5} /> podgląd
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">{f.title || f.filename}</p>
                  <div className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {formatBytes(f.size_bytes)}
                      {f.section_count != null ? ` · ${f.section_count} sekcji` : ""}
                      {f.image_count ? ` · ${f.image_count} grafik` : ""}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Usuń plik"
                      className="rounded p-1 text-muted-foreground transition hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Usunąć plik "${f.filename}"?`))
                          deleteGenMut.mutate(f.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          if (window.confirm(`Usunąć plik "${f.filename}"?`))
                            deleteGenMut.mutate(f.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </HudPanel>

      {preview && <GeneratedFilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
