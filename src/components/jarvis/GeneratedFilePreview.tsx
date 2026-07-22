// In-app preview for Producer-generated files — no download required.
//
//  - pdf : the signed URL straight into an <iframe> (browsers render PDF).
//  - pptx: no in-browser renderer exists, so we preview the PDF rendering
//          the Producer stored alongside it (kind: "preview"); if that's
//          missing (older file / failed render) we fall back to download.
//  - docx: fetched as bytes and rendered to HTML client-side via
//          docx-preview — the file never leaves the user's browser.
//
// The signed URL is minted on open and again for the download button, so a
// stale/expired URL is never an issue.

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, X } from "lucide-react";
import {
  getGeneratedFileUrlFn,
  type GeneratedFileSummary,
} from "@/lib/documents/generated.functions";

type Props = { file: GeneratedFileSummary; onClose: () => void };

export function GeneratedFilePreview({ file, onClose }: Props) {
  const getUrl = useServerFn(getGeneratedFileUrlFn);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>("");
  const docxRef = useRef<HTMLDivElement>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setIframeUrl(null);

    (async () => {
      try {
        // "preview" serves inline (and swaps in the pptx→pdf rendering when
        // one exists); pdf/docx have no separate preview object so they get
        // their own bytes served inline.
        const res = await getUrl({ data: { fileId: file.id, kind: "preview" } });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setMessage(
            file.format === "pptx"
              ? "Podgląd tej prezentacji jest niedostępny — pobierz plik, aby go otworzyć."
              : `Nie udało się wczytać podglądu: ${res.reason}`,
          );
          return;
        }

        if (file.format === "docx") {
          const resp = await fetch(res.url);
          const blob = await resp.blob();
          if (cancelled) return;
          const { renderAsync } = await import("docx-preview");
          if (docxRef.current) {
            docxRef.current.innerHTML = "";
            await renderAsync(blob, docxRef.current, undefined, {
              className: "docx-preview",
              inWrapper: true,
            });
          }
          if (!cancelled) setStatus("ready");
        } else {
          // pdf + pptx(→pdf) both render in an iframe.
          setIframeUrl(res.url);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setMessage(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  async function download() {
    try {
      const res = await getUrl({ data: { fileId: file.id, kind: "download" } });
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore — user can retry */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-primary/30 bg-[#0a0f1a] shadow-[0_0_60px_-15px_var(--primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-display text-sm tracking-wide text-primary">
              {file.title || file.filename}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {file.format} · {file.filename}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={download}
              className="font-display inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/20"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              Pobierz
            </button>
            <button
              type="button"
              aria-label="Zamknij podgląd"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-auto bg-white">
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1a] text-muted-foreground">
              <span className="font-display text-[11px] uppercase tracking-[0.3em]">
                ▸ ładowanie podglądu…
              </span>
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0f1a] px-6 text-center">
              <p className="text-sm text-muted-foreground">{message}</p>
              <button
                type="button"
                onClick={download}
                className="font-display inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/20"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                Pobierz plik
              </button>
            </div>
          )}
          {iframeUrl && (
            <iframe title={`Podgląd: ${file.filename}`} src={iframeUrl} className="h-full w-full" />
          )}
          {file.format === "docx" && (
            <div ref={docxRef} className="min-h-full bg-neutral-100 p-4 text-black" />
          )}
        </div>
      </div>
    </div>
  );
}
