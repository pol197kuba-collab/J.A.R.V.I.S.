// Mózg 3D — panele S1.3: ŚLAD (skąd J.A.R.V.I.S. to wie), OŚ CZASU (jak
// mózg rósł) i WNIOSKI (co uporządkować). Każdy otwiera się w tej samej
// karcie co szczegóły gwiazdy — od dołu na telefonie, w rogu na szerokim
// ekranie — i nigdy dwa naraz.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Lightbulb, Loader2, Pause, Play, Send, Sparkles, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrainStar, BrainTrace } from "@/lib/brain/brain.functions";
import type { BrainInsights } from "@/lib/brain/insights";
import type { BrainSourceType } from "@/lib/brain/layout";
import { ASK_PREFIX, relativeAge, stripAskPrefix, TYPE_DOT } from "@/lib/brain/scene";
import { onChat } from "@/lib/ai/chatBus";
import { useVoiceCommands } from "@/components/jarvis/VoiceCommandContext";

export type BrainPanel = "trace" | "time" | "insights";

/** Wspólna rama karty — ta sama co karta gwiazdy w BrainView. */
export function SheetFrame({
  label,
  title,
  onClose,
  children,
}: {
  label: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col rounded-t-xl border-t border-primary/25 bg-black/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_-12px_color-mix(in_oklab,var(--primary)_40%,transparent)] backdrop-blur-md",
        "@min-[900px]:inset-x-auto @min-[900px]:bottom-4 @min-[900px]:right-4 @min-[900px]:max-h-[70%] @min-[900px]:w-[380px] @min-[900px]:rounded-xl @min-[900px]:border",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
        <h2 className="min-w-0 flex-1 truncate font-display text-xs uppercase tracking-[0.25em] text-primary">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Zamknij"
          onClick={onClose}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-primary/70 hover:text-primary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4">
        {children}
      </div>
    </div>
  );
}

/** Trzy okrągłe przyciski w prawym dolnym rogu — cele dotyku 44 px. */
export function ActionDock({ onOpen }: { onOpen: (p: BrainPanel) => void }) {
  const item = (p: BrainPanel, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onOpen(p)}
      className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-black/60 text-primary backdrop-blur-md hover:bg-primary/15"
    >
      {icon}
    </button>
  );
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col gap-2 pb-[env(safe-area-inset-bottom)]">
      {item("trace", "Skąd J.A.R.V.I.S. to wie", <Zap className="h-5 w-5" />)}
      {item("time", "Oś czasu", <Clock className="h-5 w-5" />)}
      {item("insights", "Wnioski", <Lightbulb className="h-5 w-5" />)}
    </div>
  );
}

// ---------- ŚLAD ----------

const TOOL_LABEL: Record<string, string> = {
  recall: "pamięć i notatki",
  search_documents: "dokumenty",
};

export function TracePanel({
  traces,
  loading,
  activeId,
  onPick,
  onClose,
}: {
  traces: BrainTrace[];
  loading: boolean;
  activeId: string | null;
  onPick: (t: BrainTrace) => void;
  onClose: () => void;
}) {
  const { routeText } = useVoiceCommands();
  const [question, setQuestion] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const asked = useRef(false);

  // Odpowiedź przychodzi tą samą szyną co w czacie — łapiemy pierwszą
  // wypowiedź J.A.R.V.I.S.a po zadanym tu pytaniu.
  useEffect(
    () =>
      onChat((msg) => {
        if (msg.role !== "jarvis" || !asked.current) return;
        asked.current = false;
        setWaiting(false);
        setReply(msg.text);
      }),
    [],
  );

  const ask = async () => {
    const q = question.trim();
    if (!q || waiting) return;
    asked.current = true;
    setWaiting(true);
    setReply(null);
    setQuestion("");
    try {
      await routeText(`${ASK_PREFIX}${q}`);
    } finally {
      // routeText kończy się po odpowiedzi; gdyby jej nie było (błąd sieci),
      // nie zostawiamy wiecznego „myślę…”.
      setWaiting(false);
    }
  };

  return (
    <SheetFrame label="Skąd J.A.R.V.I.S. to wie" title="Skąd J.A.R.V.I.S. to wie" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Zapytaj o swoją wiedzę…"
          aria-label="Pytanie do J.A.R.V.I.S.a"
          className="h-11 min-w-0 flex-1 rounded-lg border border-primary/25 bg-black/60 px-3 font-mono text-base text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary/60 @min-[640px]:text-sm"
        />
        <button
          type="submit"
          aria-label="Zapytaj"
          disabled={waiting || !question.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/30 text-primary disabled:opacity-40"
        >
          {waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
        Gwiazdy, po które sięgnie, rozbłysną na mapie.
      </p>

      {(waiting || reply) && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.25em] text-primary/80">
            <Sparkles className="h-3 w-3" /> J.A.R.V.I.S.
          </p>
          <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
            {waiting ? "Sięgam do pamięci…" : reply}
          </p>
        </div>
      )}

      <p className="mt-4 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
        Ostatnie sięgnięcia do wiedzy
      </p>
      {loading ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">Wczytuję…</p>
      ) : traces.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground/70">
          Jeszcze żadnego. Ślad powstaje, gdy J.A.R.V.I.S. przeszukuje pamięć, notatki albo
          dokumenty — także w zwykłym czacie.
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col">
          {traces.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-2.5 border-b border-primary/10 py-2 text-left",
                  activeId === t.id && "bg-primary/10",
                )}
              >
                <Zap className="h-4 w-4 shrink-0 text-primary/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground/90">
                    {stripAskPrefix(t.query)}
                  </span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {TOOL_LABEL[t.tool] ?? t.tool} · {t.items.length} gwiazd ·{" "}
                    {relativeAge(t.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SheetFrame>
  );
}

// ---------- OŚ CZASU ----------

const DAY = 86_400_000;
/** Cała animacja „jak mózg rósł” trwa tyle, niezależnie od rozpiętości dat. */
const PLAY_MS = 7_000;

export function TimePanel({
  stars,
  until,
  onChange,
  onClose,
}: {
  stars: BrainStar[];
  until: number | null;
  onChange: (t: number | null) => void;
  onClose: () => void;
}) {
  const times = stars.map((s) => Date.parse(s.createdAt)).filter(Number.isFinite);
  const min = times.length ? Math.min(...times) : Date.now();
  const max = Math.max(Date.now(), min + DAY);
  const value = until ?? max;
  const visible = times.filter((t) => t <= value).length;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / PLAY_MS);
      onChange(min + (max - min) * k);
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        setPlaying(false);
        onChange(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // min/max liczone z danych — animacja startuje od nowa tylko po „Odtwórz”.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const label = new Date(value).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <SheetFrame label="Oś czasu" title="Jak rósł Mózg" onClose={onClose}>
      <p className="font-mono text-sm text-foreground">
        {until === null ? "Dziś" : label}
        <span className="ml-2 text-muted-foreground">
          {visible} z {times.length} gwiazd
        </span>
      </p>
      <input
        type="range"
        min={min}
        max={max}
        step={DAY / 4}
        value={value}
        aria-label="Data na osi czasu"
        onChange={(e) => {
          setPlaying(false);
          const v = Number(e.target.value);
          onChange(v >= max ? null : v);
        }}
        // Duży uchwyt na dotyk; kolor z tokenu.
        className="mt-3 h-11 w-full cursor-pointer accent-[var(--primary)]"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{new Date(min).toLocaleDateString("pl-PL")}</span>
        <span>dziś</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              onChange(min);
              setPlaying(true);
            }
          }}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? "Pauza" : "Odtwórz"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(null);
          }}
          className="flex h-11 flex-1 items-center justify-center rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
        >
          Dziś
        </button>
      </div>
    </SheetFrame>
  );
}

// ---------- WNIOSKI ----------

export function InsightsPanel({
  insights,
  computedAt,
  clusterNames,
  onPick,
  onClose,
}: {
  insights: BrainInsights;
  computedAt: string | null;
  clusterNames: Map<number, string>;
  onPick: (type: BrainSourceType, id: string) => void;
  onClose: () => void;
}) {
  const { duplicates, orphans, clustersWithoutNote } = insights;
  const nothing = duplicates.length + orphans.length + clustersWithoutNote.length === 0;
  const row = (type: BrainSourceType, id: string, text: string, aside?: string) => (
    <button
      key={`${type}:${id}:${text}`}
      type="button"
      onClick={() => onPick(type, id)}
      className="flex min-h-11 w-full items-center gap-2.5 border-b border-primary/10 py-2 text-left"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[type])} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{text}</span>
      {aside && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{aside}</span>
      )}
    </button>
  );
  const heading = (text: string, hint: string) => (
    <div className="mt-4 first:mt-1">
      <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">{text}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <SheetFrame label="Wnioski" title="Wnioski" onClose={onClose}>
      {computedAt === null ? (
        <p className="text-sm text-foreground/70">Wnioski pojawią się po nocnym przeliczeniu.</p>
      ) : nothing ? (
        <p className="text-sm leading-relaxed text-foreground/70">
          Porządek: bez duplikatów, bez samotnych gwiazd, każda duża gromada ma notatkę.
        </p>
      ) : null}

      {duplicates.length > 0 && (
        <>
          {heading("Do scalenia", "Prawie to samo zapisane dwa razy.")}
          {duplicates.map((d) =>
            row(
              d.a.type,
              d.a.id,
              `${d.a.label} ↔ ${d.b.label}`,
              `${Math.round(d.similarity * 100)}%`,
            ),
          )}
        </>
      )}
      {orphans.length > 0 && (
        <>
          {heading(
            "Samotne gwiazdy",
            "Słabo powiązane z resztą — nowy temat albo coś do dopisania.",
          )}
          {orphans.map((o) => row(o.type, o.id, o.label))}
        </>
      )}
      {clustersWithoutNote.length > 0 && (
        <>
          {heading("Gromady bez notatki", "Same wspomnienia i dokumenty — warto je podsumować.")}
          {clustersWithoutNote.map((c) => (
            <div
              key={c.cluster}
              className="flex min-h-11 items-center gap-2 border-b border-primary/10 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                {clusterNames.get(c.cluster) ?? `Gromada ${c.cluster + 1}`}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{c.size}</span>
              <Link
                to="/notes"
                className="flex h-9 items-center rounded-md border border-primary/30 px-2.5 font-display text-[9px] uppercase tracking-widest text-primary"
              >
                Podsumuj
              </Link>
            </div>
          ))}
        </>
      )}
      {computedAt && (
        <p className="mt-4 font-mono text-[10px] text-muted-foreground">
          Z nocnego przeliczenia · {relativeAge(computedAt)}
        </p>
      )}
    </SheetFrame>
  );
}
