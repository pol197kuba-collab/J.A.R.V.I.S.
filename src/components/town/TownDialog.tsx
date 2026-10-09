import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { TownSlug } from "./townMap";
import { GREETING } from "./townTalk";

export type DialogTarget = { kind: "agent"; slug: TownSlug } | { kind: "board" };
export type BoardNote = {
  id: string;
  title: string;
  text: string;
  ok: boolean;
  at: number;
  read: boolean;
};

type View =
  | { kind: "menu" }
  | { kind: "say"; text: string }
  | { kind: "command" }
  | { kind: "note"; note: BoardNote };
type Option = { label: string; run: () => void };

/**
 * RPG-style dialog box over the map: who you're talking to, a line of text
 * that types itself out, and a ▶ menu you can drive with ↑/↓, Enter and Esc.
 */
export function TownDialog({
  target,
  name,
  drawPortrait,
  statusText,
  resultText,
  notes,
  onRead,
  onCommand,
  onClose,
}: {
  target: DialogTarget;
  name: (slug: TownSlug) => string;
  drawPortrait: (cv: HTMLCanvasElement, slug: TownSlug) => void;
  statusText: (slug: TownSlug) => string;
  resultText: (slug: TownSlug) => string;
  notes: readonly BoardNote[];
  onRead: (id: string) => void;
  onCommand: (text: string, to: TownSlug | "auto") => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "menu" });
  const [focus, setFocus] = useState(0);
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const portraitRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const slug = target.kind === "agent" ? target.slug : "jarvis";
  const speaker = target.kind === "agent" ? name(target.slug) : "Tablica zadań";

  useEffect(() => {
    if (portraitRef.current) drawPortrait(portraitRef.current, slug);
  }, [drawPortrait, slug]);
  useEffect(() => {
    if (view.kind === "command") inputRef.current?.focus();
    else boxRef.current?.focus();
    setFocus(0);
  }, [view]);

  const line =
    view.kind === "say"
      ? view.text
      : view.kind === "note"
        ? view.note.text
        : view.kind === "command"
          ? target.kind === "agent" && target.slug !== "jarvis"
            ? "Co mam dla Ciebie zrobić?"
            : "Napisz polecenie. J.A.R.V.I.S. rozdzieli pracę."
          : target.kind === "board"
            ? notes.length
              ? `Na tablicy ${notes.length === 1 ? "wisi 1 wynik" : `wiszą wyniki: ${notes.length}`}${notes.some((n) => !n.read) ? ", w tym nieprzeczytane" : ""}.`
              : "Tablica jest pusta. Wyniki Twoich poleceń pojawią się tutaj."
            : GREETING[target.slug as Exclude<TownSlug, "user">];
  const typed = useTypewriter(line);

  const back = () => setView({ kind: "menu" });
  const options: Option[] = useMemo(() => {
    if (view.kind === "command") return [];
    if (view.kind !== "menu") return [{ label: "Wróć", run: back }];
    if (target.kind === "board")
      return [
        ...notes.slice(0, 5).map((n) => ({
          label: `${n.read ? "" : "! "}${n.title}`,
          run: () => {
            onRead(n.id);
            setView({ kind: "note", note: n });
          },
        })),
        { label: "Przypnij nowe polecenie", run: () => setView({ kind: "command" }) },
        { label: "Odejdź", run: onClose },
      ];
    const s = target.slug;
    return [
      { label: "Zleć zadanie", run: () => setView({ kind: "command" }) },
      { label: "Jak idzie?", run: () => setView({ kind: "say", text: statusText(s) }) },
      { label: "Pokaż ostatni wynik", run: () => setView({ kind: "say", text: resultText(s) }) },
      { label: "Do zobaczenia", run: onClose },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, target, notes]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view.kind === "menu") onClose();
      else back();
      return;
    }
    if (view.kind === "command" || !options.length) return;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      setFocus((f) => (f + 1) % options.length);
    } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      setFocus((f) => (f - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " " || e.key === "e" || e.key === "E") {
      e.preventDefault();
      options[focus]?.run();
    }
  };

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`Rozmowa: ${speaker}`}
      tabIndex={-1}
      onKeyDown={onKey}
      className="absolute inset-x-3 bottom-3 z-10 grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-[3px] border-foreground/80 bg-card p-3 shadow-[4px_4px_0_rgba(0,0,0,0.6)] focus:outline-none @max-[420px]:inset-x-1 @max-[420px]:grid-cols-[48px_minmax(0,1fr)]"
    >
      <canvas
        ref={portraitRef}
        width={64}
        height={64}
        aria-hidden
        className="h-16 w-16 border-2 border-border bg-background @max-[420px]:h-12 @max-[420px]:w-12"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="min-w-0">
        <p className="font-display text-sm text-primary">{speaker}</p>
        <p
          className="no-scrollbar mt-1 max-h-32 overflow-y-auto overflow-x-hidden whitespace-pre-line break-words text-sm text-foreground"
          aria-live="polite"
        >
          {typed}
        </p>
        {view.kind === "command" ? (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              onCommand(
                text,
                target.kind === "agent" && target.slug !== "jarvis" ? target.slug : "auto",
              );
              setDraft("");
              setView({
                kind: "say",
                text:
                  target.kind === "board"
                    ? "Przypięte! J.A.R.V.I.S. zaraz to weźmie."
                    : `${name(slug)}: Zrozumiano, zabieram się do pracy.`,
              });
            }}
          >
            <input
              ref={inputRef}
              id="town-dialog-command"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="np. Sprawdź ceny paliw na jutro"
              aria-label="Treść polecenia"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              className="font-display rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              Zleć
            </button>
            <button
              type="button"
              onClick={back}
              className="font-display rounded-md border border-border px-3 py-1.5 text-xs text-foreground"
            >
              Wróć
            </button>
          </form>
        ) : (
          <ul className="mt-2 grid gap-0.5">
            {options.map((o, i) => (
              <li key={o.label}>
                <button
                  type="button"
                  onMouseEnter={() => setFocus(i)}
                  onClick={o.run}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-1.5 text-left text-sm",
                    i === focus ? "text-primary" : "text-foreground",
                  )}
                >
                  <span aria-hidden className={i === focus ? "text-primary" : "text-transparent"}>
                    ▶
                  </span>
                  <span className="min-w-0 truncate">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Reveal `text` a few characters at a time, like an RPG text box. */
function useTypewriter(text: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = window.setInterval(() => {
      setN((k) => {
        if (k >= text.length) {
          window.clearInterval(id);
          return k;
        }
        return k + 2;
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);
  return text.slice(0, n);
}
