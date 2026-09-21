// Podgląd plików F.O.R.G.E. w aplikacji — bez pobierania.
//
//  - pptx: slajdy rysowane w Reakcie z zapisanej specyfikacji (DeckPreview).
//          Żaden plik nie jest w tym celu pobierany ani renderowany drugi raz.
//  - docx: bajty pobrane i wyrenderowane do HTML po stronie przeglądarki
//          przez docx-preview — plik nie opuszcza urządzenia.
//
// Do prezentacji nie mintujemy już URL-a przy otwarciu: podgląd nie potrzebuje
// samego pliku. Przycisk pobierania mintuje własny, świeży URL, więc wygasły
// link nigdy nie jest problemem.

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, X } from "lucide-react";
import {
  getGeneratedFileUrlFn,
  getGeneratedSpecFn,
  type GeneratedFileSummary,
} from "@/lib/documents/generated.functions";
import { DeckPreview } from "./DeckPreview";
import type { DeckSpec } from "@/lib/agents/docSpec";

type Props = { file: GeneratedFileSummary; onClose: () => void };

export function GeneratedFilePreview({ file, onClose }: Props) {
  const getUrl = useServerFn(getGeneratedFileUrlFn);
  const getSpec = useServerFn(getGeneratedSpecFn);
  const [deck, setDeck] = useState<DeckSpec | null>(null);
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
    setDeck(null);

    (async () => {
      try {
        if (file.format === "pptx") {
          // Prezentacja: bierzemy sam opis, nie plik. Starsze pliki sprzed
          // rozdzielenia specyfikacji trzymają „sections" zamiast „slides" —
          // mapujemy je, zamiast pokazywać użytkownikowi błąd za decyzję
          // architektoniczną, której nie podejmował.
          const res = await getSpec({ data: { fileId: file.id } });
          if (cancelled) return;
          if (!res.ok) {
            setStatus("error");
            setMessage("Podgląd tej prezentacji jest niedostępny — pobierz plik, aby go otworzyć.");
            return;
          }
          const raw = res.spec as Partial<DeckSpec> & { sections?: DeckSpec["slides"] };
          const slides = raw.slides ?? raw.sections ?? [];
          if (slides.length === 0) {
            setStatus("error");
            setMessage("Ta prezentacja nie ma zapisanej treści — pobierz plik, aby ją otworzyć.");
            return;
          }
          setDeck({ ...(raw as DeckSpec), format: "pptx", slides });
          setStatus("ready");
          return;
        }

        const res = await getUrl({ data: { fileId: file.id, kind: "preview" } });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setMessage(`Nie udało się wczytać podglądu: ${res.reason}`);
          return;
        }

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
          {deck && <DeckPreview spec={deck} />}
          {file.format === "docx" && (
            <div ref={docxRef} className="min-h-full bg-neutral-100 p-4 text-black" />
          )}
        </div>
      </div>
    </div>
  );
}
