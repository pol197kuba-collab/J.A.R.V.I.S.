import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { RunFile } from "@/lib/agents/flow.functions";
import type { TownSlug } from "./townMap";
import { GREETING } from "./townTalk";
import { TownArcade } from "./TownArcade";

export type DialogTarget =
  | { kind: "agent"; slug: TownSlug }
  /** `noteId`: open straight on that note (Marvel brought it to you). */
  | { kind: "board"; noteId?: string }
  | { kind: "prop"; id: string };
/** A result's full answer and files, fetched when its note is opened. */
export type NoteDetail = { text: string | null; files: RunFile[]; loading: boolean };
/** What a prop's dialog can do in response to a menu choice. */
export type PropUi = { say: (text: string) => void; game: () => void; close: () => void };
export type PropContent = {
  title: string;
  /** Whose portrait to show: a character, or the dog. */
  portrait: TownSlug | "dog";
  line: string;
  options: { label: string; run: (ui: PropUi) => void }[];
};
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
  | { kind: "note"; note: BoardNote }
  | { kind: "fault"; text: string }
  | { kind: "game" };
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
  propContent,
  onArcadeScore,
  placement = "bottom",
  faultText,
  onRetry,
  noteDetail,
  onDownload,
  onOpenNote,
  onFaultSeen,
}: {
  target: DialogTarget;
  name: (slug: TownSlug) => string;
  drawPortrait: (cv: HTMLCanvasElement, who: TownSlug | "dog") => void;
  statusText: (slug: TownSlug) => string;
  resultText: (slug: TownSlug) => string;
  notes: readonly BoardNote[];
  onRead: (id: string) => void;
  onCommand: (text: string, to: TownSlug | "auto") => void;
  onClose: () => void;
  /** Content for a prop (coffee machine, shelf, arcade…). */
  propContent?: (id: string) => PropContent;
  onArcadeScore?: (score: number) => void;
  /** Which edge of the map the box sits on (the half your character isn't in). */
  placement?: "top" | "bottom";
  /** "Co się stało?" — why this agent's last task failed; null when it didn't. */
  faultText?: (slug: TownSlug) => string | null;
  /** Retry that failed task; null when it can't be retried. */
  onRetry?: (slug: TownSlug) => (() => void) | null;
  noteDetail?: (id: string) => NoteDetail;
  onDownload?: (file: RunFile) => void;
  /** A note was opened — fetch its full answer and files. */
  onOpenNote?: (id: string) => void;
  /** You read why an agent's task failed. */
  onFaultSeen?: (slug: TownSlug) => void;
}) {
  const [view, setView] = useState<View>(() => {
    const n =
      target.kind === "board" && target.noteId
        ? notes.find((x) => x.id === target.noteId)
        : undefined;
    if (n) onRead(n.id);
    return n ? { kind: "note", note: n } : { kind: "menu" };
  });
  const [focus, setFocus] = useState(0);
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const portraitRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prop = target.kind === "prop" ? (propContent?.(target.id) ?? null) : null;
  const slug = target.kind === "agent" ? target.slug : "jarvis";
  const portrait: TownSlug | "dog" = prop ? prop.portrait : slug;
  const speaker = target.kind === "agent" ? name(target.slug) : prop ? prop.title : "Tablica zadań";

  useEffect(() => {
    if (portraitRef.current) drawPortrait(portraitRef.current, portrait);
  }, [drawPortrait, portrait]);
  useEffect(() => {
    if (view.kind === "note") onOpenNote?.(view.note.id);
    if (view.kind === "fault" && target.kind === "agent") onFaultSeen?.(target.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    if (view.kind === "command") inputRef.current?.focus();
    else if (view.kind !== "game") boxRef.current?.focus();
    setFocus(0);
  }, [view]);

  const detail = view.kind === "note" ? noteDetail?.(view.note.id) : undefined;
  const line =
    view.kind === "say" || view.kind === "fault"
      ? view.text
      : view.kind === "note"
        ? detail?.text?.trim() || view.note.text
        : view.kind === "game"
          ? "Złap buga! Każdy złapany zwęża cel i przyspiesza kursor."
          : view.kind === "command"
            ? target.kind === "agent" && target.slug !== "jarvis"
              ? "Co mam dla Ciebie zrobić?"
              : "Napisz polecenie. J.A.R.V.I.S. rozdzieli pracę."
            : prop
              ? prop.line
              : target.kind === "board"
                ? notes.length
                  ? `Na tablicy ${notes.length === 1 ? "wisi 1 wynik" : `wiszą wyniki: ${notes.length}`}${notes.some((n) => !n.read) ? ", w tym nieprzeczytane" : ""}.`
                  : "Tablica jest pusta. Wyniki Twoich poleceń pojawią się tutaj."
                : target.kind === "agent"
                  ? GREETING[target.slug as Exclude<TownSlug, "user">]
                  : "";
  // a full answer can be long — show it at once instead of typing it out
  const typed = useTypewriter(line, view.kind === "note");

  const back = () => setView({ kind: "menu" });
  const ui: PropUi = {
    say: (text) => setView({ kind: "say", text }),
    game: () => setView({ kind: "game" }),
    close: onClose,
  };
  const propOptions: Option[] | null =
    prop && view.kind === "menu"
      ? [
          ...prop.options.map((o) => ({ label: o.label, run: () => o.run(ui) })),
          { label: "Odejdź", run: onClose },
        ]
      : null;
  const menuOptions: Option[] = useMemo(() => {
    if (view.kind === "command" || view.kind === "game") return [];
    if (view.kind === "fault" && target.kind === "agent") {
      const retry = onRetry?.(target.slug);
      return [
        ...(retry
          ? [
              {
                label: "Ponów zadanie",
                run: () => {
                  retry();
                  setView({
                    kind: "say",
                    text: `${name(target.slug)}: Spróbuję jeszcze raz.`,
                  });
                },
              },
            ]
          : []),
        { label: "Wróć", run: back },
      ];
    }
    if (view.kind === "note") {
      return [
        ...(detail?.files ?? []).map((f) => ({
          label: `Pobierz: ${f.filename}`,
          run: () => onDownload?.(f),
        })),
        { label: "Wróć", run: back },
      ];
    }
    if (view.kind !== "menu") return [{ label: "Wróć", run: back }];
    if (target.kind === "prop") return [];
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
    const fault = faultText?.(s);
    return [
      ...(fault
        ? [{ label: "! Co się stało?", run: () => setView({ kind: "fault", text: fault }) }]
        : []),
      { label: "Zleć zadanie", run: () => setView({ kind: "command" }) },
      { label: "Jak idzie?", run: () => setView({ kind: "say", text: statusText(s) }) },
      { label: "Pokaż ostatni wynik", run: () => setView({ kind: "say", text: resultText(s) }) },
      { label: "Do zobaczenia", run: onClose },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, target, notes, detail?.files, detail?.loading]);
  const options = propOptions ?? menuOptions;

  const onKey = (e: KeyboardEvent) => {
    // Keys pressed in the dialog stay in the dialog: otherwise the E that
    // picks "Odejdź" reaches the map's "E = use" handler right after the
    // dialog closes and reopens it on the spot.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (view.kind === "menu") onClose();
      else back();
      return;
    }
    if (view.kind === "command" || view.kind === "game" || !options.length) return;
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
      className={cn(
        "absolute inset-x-3 z-10 grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-[3px] border-foreground/80 bg-card p-3 shadow-[4px_4px_0_rgba(0,0,0,0.6)] focus:outline-none @max-[420px]:inset-x-1 @max-[420px]:grid-cols-[48px_minmax(0,1fr)]",
        placement === "top" ? "top-3" : "bottom-3",
      )}
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
          className={cn(
            "no-scrollbar mt-1 overflow-y-auto overflow-x-hidden whitespace-pre-line break-words text-sm text-foreground",
            view.kind === "note" ? "max-h-64" : "max-h-32",
          )}
          aria-live="polite"
        >
          {typed}
        </p>
        {view.kind === "game" ? (
          <TownArcade
            onExit={(score) => {
              onArcadeScore?.(score);
              back();
            }}
          />
        ) : view.kind === "command" ? (
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
function useTypewriter(text: string, instant = false) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
  }, [text, instant]);
  return text.slice(0, n);
}
