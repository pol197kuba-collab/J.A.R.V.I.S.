// Mózg 3D — strona /mozg: scena + nakładki (wyszukiwarka, legenda, karta).
//
// Układ projektowany od telefonu w pionie:
// - u góry wyszukiwarka i przełącznik 3D / LISTA, pod nimi legenda typów
//   (tapnięcie chowa/pokazuje typ) i status układu;
// - zaznaczona gwiazda otwiera kartę wysuwaną od dołu (bottom sheet) —
//   na szerokim ekranie ta sama karta pływa w prawym dolnym rogu;
// - LISTA to pełnoprawna alternatywa dla 3D: gromady → elementy, ten sam
//   stan wyszukiwania i ta sama karta. Dla słabszych telefonów, dostępności
//   i urządzeń bez WebGL (wtedy jest jedynym trybem).
//
// Szerokość czytana z @container na <main> (DashboardShell), nie z viewportu.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain,
  ChevronDown,
  Database,
  Crosshair,
  ExternalLink,
  Loader2,
  Search,
  X,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  getBrain,
  getBrainItem,
  getBrainTraces,
  toBrainTrace,
  type BrainCluster,
  type BrainStar,
  type BrainTrace,
} from "@/lib/brain/brain.functions";
import { ActionDock, InsightsPanel, TimePanel, TracePanel, type BrainPanel } from "./BrainPanels";
import { CenterNote, KindSwitch, ModeToggle } from "./brainUi";
import {
  SHEET_SIDE_MIN,
  SHEET_VIEW_SHIFT,
  useBrainMode,
  useElementSize,
  type BrainKind,
} from "./hooks";
import type { BrainSourceType } from "@/lib/brain/layout";
import {
  nearestNeighbors,
  relativeAge,
  searchStars,
  TYPE_LABEL,
  TYPE_LABEL_PLURAL,
  TYPE_DOT,
  stripAskPrefix,
} from "@/lib/brain/scene";

// three.js ładowany dopiero na tej stronie — reszta aplikacji go nie płaci.
const BrainScene = lazy(() => import("./BrainScene").then((m) => ({ default: m.BrainScene })));

const ALL_TYPES: BrainSourceType[] = ["memory", "note", "document"];
const TRACES_KEY = ["brain", "traces"] as const;
const NEIGHBORS = 5;

const starKey = (s: Pick<BrainStar, "type" | "id">) => `${s.type}:${s.id}`;

/** Tabela, z której pochodzi gwiazda danego typu — dla przejścia do STRUKTURY. */
const SOURCE_TABLE: Record<BrainSourceType, string> = {
  memory: "memories",
  note: "notes",
  document: "documents",
};

export function BrainView({
  kind,
  onKindChange,
  onShowInStructure,
}: {
  kind: BrainKind;
  onKindChange: (k: BrainKind) => void;
  onShowInStructure: (table: string) => void;
}) {
  const fetchBrain = useServerFn(getBrain);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["brain", "snapshot"],
    queryFn: () => fetchBrain(),
    // Nowe gwiazdy dokłada baza (brain_sync przy każdym odczycie).
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const stars = useMemo(() => data?.stars ?? [], [data]);
  const clusters = useMemo(() => data?.clusters ?? [], [data]);
  const clusterNames = useMemo(() => new Map(clusters.map((c) => [c.id, c.name])), [clusters]);

  const { webgl, mode, setMode, effectiveMode } = useBrainMode();

  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<BrainSourceType>>(
    () => new Set(ALL_TYPES),
  );
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Zaznaczenie po kluczu, nie po indeksie — odświeżenie danych może
  // zmienić kolejność gwiazd.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ index: number; nonce: number } | null>(null);
  const [panel, setPanel] = useState<BrainPanel | null>(null);
  const [activeTrace, setActiveTrace] = useState<BrainTrace | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const qc = useQueryClient();
  const fetchTraces = useServerFn(getBrainTraces);
  const traces = useQuery({
    queryKey: TRACES_KEY,
    queryFn: () => fetchTraces(),
    enabled: panel === "trace",
  });
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>();
  const [toolbarRef, toolbarSize] = useElementSize<HTMLDivElement>();

  const indexByKey = useMemo(() => new Map(stars.map((s, i) => [starKey(s), i])), [stars]);
  const selected = selectedKey === null ? null : (indexByKey.get(selectedKey) ?? null);

  const results = useMemo(
    () =>
      searchStars(stars, clusterNames, query, 30).filter((i) => visibleTypes.has(stars[i].type)),
    [stars, clusterNames, query, visibleTypes],
  );
  const traceIndices = useMemo(
    () =>
      (activeTrace?.items ?? [])
        .map((it) => indexByKey.get(`${it.type}:${it.id}`))
        .filter((i): i is number => i !== undefined),
    [activeTrace, indexByKey],
  );
  // Wyszukiwanie wygrywa ze śladem — to, czego użytkownik szuka teraz.
  const highlighted = useMemo(
    () => new Set(query.trim() ? results : panel === "time" ? [] : traceIndices),
    [results, query, traceIndices, panel],
  );
  const neighbors = useMemo(
    () =>
      selected === null
        ? []
        : nearestNeighbors(stars, selected, NEIGHBORS * 3)
            .filter((i) => visibleTypes.has(stars[i].type))
            .slice(0, NEIGHBORS),
    [stars, selected, visibleTypes],
  );

  const counts = useMemo(() => {
    const c: Record<BrainSourceType, number> = { memory: 0, note: 0, document: 0 };
    for (const s of stars) c[s.type]++;
    return c;
  }, [stars]);

  const select = (index: number | null, fly = false) => {
    if (index !== null) setPanel(null);
    setSelectedKey(index === null ? null : starKey(stars[index]));
    if (fly && index !== null) setFocus({ index, nonce: Date.now() });
  };

  const toggleType = (t: BrainSourceType) =>
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      // Pusta legenda to pusta scena — ostatniego typu nie da się schować.
      return next.size === 0 ? prev : next;
    });

  const openPanel = (p: BrainPanel | null) => {
    setSelectedKey(null);
    if (p !== "time") setUntil(null);
    setPanel(p);
  };

  // Nowe ślady na żywo: J.A.R.V.I.S. sięga do wiedzy (także z czatu na
  // innym urządzeniu) → gwiazdy rozbłyskują od razu. RLS obowiązuje też
  // w Realtime, więc przychodzą wyłącznie własne ślady.
  useEffect(() => {
    const channel = supabase
      .channel("brain-traces")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "brain_traces" },
        (payload) => {
          const trace = toBrainTrace(payload.new as Parameters<typeof toBrainTrace>[0]);
          setActiveTrace(trace);
          qc.setQueryData<BrainTrace[]>(TRACES_KEY, (prev) => [trace, ...(prev ?? [])]);
          // Ślad może wskazywać gwiazdę dodaną przed chwilą — odśwież mapę.
          void qc.invalidateQueries({ queryKey: ["brain", "snapshot"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  // Zaznaczona gwiazda schowana filtrem — karta się zamyka.
  useEffect(() => {
    if (selected !== null && !visibleTypes.has(stars[selected].type)) setSelectedKey(null);
  }, [selected, visibleTypes, stars]);

  return (
    // Stała wysokość okna jak /jarvis: scena 3D nie przewija strony, tylko
    // wypełnia ją. Na telefonie (portrait) DashboardShell ma już h-[100dvh],
    // więc h-full jest określone.
    <div
      ref={rootRef}
      className="relative h-[calc(100dvh-3rem)] min-h-[480px] w-full overflow-hidden bg-background portrait:h-full portrait:min-h-0 landscape:max-md:h-full landscape:max-md:min-h-0 short:h-full short:min-h-0"
    >
      {isLoading ? (
        <CenterNote icon={<Loader2 className="h-5 w-5 animate-spin" />}>
          Ładuję mapę wiedzy…
        </CenterNote>
      ) : isError ? (
        <CenterNote icon={<Brain className="h-5 w-5" />}>
          Nie udało się wczytać Mózgu.{" "}
          <button className="underline" onClick={() => refetch()}>
            Spróbuj ponownie
          </button>
        </CenterNote>
      ) : stars.length === 0 ? (
        <EmptyBrain hasLayout={Boolean(data?.layout)} />
      ) : effectiveMode === "3d" ? (
        <Suspense
          fallback={
            <CenterNote icon={<Loader2 className="h-5 w-5 animate-spin" />}>
              Uruchamiam scenę…
            </CenterNote>
          }
        >
          <BrainScene
            stars={stars}
            clusters={clusters}
            visibleTypes={visibleTypes}
            selected={selected}
            highlighted={highlighted}
            neighbors={neighbors}
            focus={focus}
            onSelect={(i) => select(i)}
            onFocus={(i) => setFocus({ index: i, nonce: Date.now() })}
            showClusterLabels={!query.trim() && !activeTrace}
            viewShift={
              (selected !== null || panel !== null) &&
              rootSize.width > 0 &&
              rootSize.width < SHEET_SIDE_MIN
                ? SHEET_VIEW_SHIFT
                : 0
            }
            trace={
              // Na osi czasu ślad by celował w gwiazdy, których „jeszcze nie ma”.
              activeTrace && traceIndices.length > 0 && panel !== "time"
                ? { key: activeTrace.id, indices: traceIndices }
                : null
            }
            until={until}
          />
        </Suspense>
      ) : (
        <BrainList
          stars={stars}
          clusters={clusters}
          visibleTypes={visibleTypes}
          onlyIndices={query.trim() ? results : null}
          selected={selected}
          onSelect={(i) => select(i)}
          topInset={toolbarSize.height}
        />
      )}

      {/* Górna nakładka: wyszukiwarka, tryb, legenda. Klikalne są tylko
          same kontrolki — reszta przepuszcza gesty do sceny. */}
      <div
        ref={toolbarRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 @min-[640px]:p-4"
      >
        <KindSwitch kind={kind} onChange={onKindChange} />
        {stars.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <div className="pointer-events-auto relative min-w-0 flex-1 @min-[640px]:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary/60" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      setSearchOpen(false);
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Enter" && results[0] !== undefined) {
                      select(results[0], true);
                      setSearchOpen(false);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="Szukaj w Mózgu…"
                  aria-label="Szukaj w Mózgu"
                  // text-base na telefonie: iOS przybliża stronę przy polach < 16 px.
                  className="h-11 w-full rounded-lg border border-primary/25 bg-black/60 pl-9 pr-10 font-mono text-base text-foreground placeholder:text-muted-foreground/70 backdrop-blur-md outline-none focus:border-primary/60 @min-[640px]:h-10 @min-[640px]:text-sm"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Wyczyść wyszukiwanie"
                    onClick={() => {
                      setQuery("");
                      setSearchOpen(false);
                    }}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-primary/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {searchOpen && query.trim() && (
                  <SearchResults
                    stars={stars}
                    clusterNames={clusterNames}
                    results={results}
                    onPick={(i) => {
                      select(i, true);
                      setSearchOpen(false);
                    }}
                  />
                )}
              </div>
              {webgl && <ModeToggle mode={mode} onChange={setMode} />}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {ALL_TYPES.filter((t) => counts[t] > 0).map((t) => {
                const on = visibleTypes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleType(t)}
                    className={cn(
                      "pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border px-2.5 font-display text-[10px] uppercase tracking-wider backdrop-blur-md transition-opacity",
                      on
                        ? "border-primary/30 bg-black/60 text-foreground"
                        : "border-primary/10 bg-black/40 text-muted-foreground opacity-60",
                    )}
                  >
                    <span
                      className={cn("h-2 w-2 rounded-full", TYPE_DOT[t], !on && "opacity-40")}
                    />
                    {TYPE_LABEL_PLURAL[t]}
                    <span className="font-mono text-muted-foreground">{counts[t]}</span>
                  </button>
                );
              })}
              <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground @min-[640px]:inline">
                {stars.length} gwiazd · {clusters.length} gromad
                {data?.layout ? ` · układ ${relativeAge(data.layout.computedAt)}` : ""}
              </span>
            </div>

            {activeTrace && panel !== "trace" && (
              <div className="pointer-events-auto flex min-h-10 max-w-md items-center gap-2 self-start rounded-lg border border-primary/40 bg-black/70 pl-3 backdrop-blur-md">
                <Zap className="h-4 w-4 shrink-0 text-primary" />
                <button
                  type="button"
                  onClick={() => openPanel("trace")}
                  className="min-w-0 flex-1 truncate py-2 text-left text-sm text-foreground/90"
                >
                  {stripAskPrefix(activeTrace.query)}
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    · {traceIndices.length} gwiazd
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Zgaś ślad"
                  onClick={() => setActiveTrace(null)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-primary/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected !== null && (
        <StarSheet
          star={stars[selected]}
          clusterName={
            stars[selected].cluster === null ? null : clusterNames.get(stars[selected].cluster!)
          }
          neighbors={neighbors.map((i) => ({ index: i, star: stars[i] }))}
          canFly={effectiveMode === "3d"}
          onClose={() => setSelectedKey(null)}
          onFly={() => setFocus({ index: selected, nonce: Date.now() })}
          onPick={(i) => select(i, effectiveMode === "3d")}
          onShowInStructure={() => onShowInStructure(SOURCE_TABLE[stars[selected].type])}
        />
      )}

      {selected === null && panel === null && stars.length > 0 && <ActionDock onOpen={openPanel} />}
      {panel === "trace" && (
        <TracePanel
          traces={traces.data ?? []}
          loading={traces.isLoading}
          activeId={activeTrace?.id ?? null}
          onPick={(t) => {
            setActiveTrace(t);
            setPanel(null);
          }}
          onAnswered={(question, items) => {
            // Wszystkie źródła odpowiedzi naraz (pamięć, notatki, dokumenty);
            // zapisane ślady i tak dojdą przez Realtime — lista się odświeży.
            if (items.length > 0) {
              setActiveTrace({
                id: `ask-${Date.now()}`,
                tool: "recall",
                query: question,
                items,
                createdAt: new Date().toISOString(),
              });
            }
            void qc.invalidateQueries({ queryKey: TRACES_KEY });
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "time" && (
        <TimePanel
          stars={stars}
          until={until}
          onChange={setUntil}
          onClose={() => openPanel(null)}
        />
      )}
      {panel === "insights" && data && (
        <InsightsPanel
          insights={data.insights}
          computedAt={data.layout?.computedAt ?? null}
          clusterNames={clusterNames}
          onPick={(type, id) => {
            const i = indexByKey.get(`${type}:${id}`);
            if (i !== undefined) select(i, effectiveMode === "3d");
          }}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function SearchResults({
  stars,
  clusterNames,
  results,
  onPick,
}: {
  stars: BrainStar[];
  clusterNames: Map<number, string>;
  results: number[];
  onPick: (i: number) => void;
}) {
  return (
    <div className="no-scrollbar absolute inset-x-0 top-full z-30 mt-1 max-h-[min(50dvh,360px)] overflow-y-auto overflow-x-hidden rounded-lg border border-primary/25 bg-black/80 backdrop-blur-md">
      {results.length === 0 ? (
        <p className="px-3 py-3 font-mono text-xs text-muted-foreground">Nic nie znalazłem.</p>
      ) : (
        results.map((i) => {
          const s = stars[i];
          return (
            <button
              key={starKey(s)}
              type="button"
              onClick={() => onPick(i)}
              className="flex min-h-11 w-full items-center gap-2.5 border-b border-primary/10 px-3 py-2 text-left last:border-b-0 hover:bg-primary/10"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[s.type])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{s.label}</span>
                <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {TYPE_LABEL[s.type]}
                  {s.cluster !== null && clusterNames.get(s.cluster)
                    ? ` · ${clusterNames.get(s.cluster)}`
                    : ""}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function StarSheet({
  star,
  clusterName,
  neighbors,
  canFly,
  onClose,
  onFly,
  onPick,
  onShowInStructure,
}: {
  star: BrainStar;
  clusterName: string | null | undefined;
  neighbors: { index: number; star: BrainStar }[];
  canFly: boolean;
  onClose: () => void;
  onFly: () => void;
  onPick: (index: number) => void;
  /** Przejście do trybu STRUKTURA — do tabeli, z której pochodzi gwiazda. */
  onShowInStructure: () => void;
}) {
  const fetchItem = useServerFn(getBrainItem);
  const [expanded, setExpanded] = useState(false);
  const { data: detail, isLoading } = useQuery({
    queryKey: ["brain", "item", star.type, star.id],
    queryFn: () => fetchItem({ data: { type: star.type, id: star.id } }),
    staleTime: 60_000,
  });
  useEffect(() => setExpanded(false), [star.id]);

  const sourceLink =
    star.type === "note" ? "/notes" : star.type === "document" ? "/documents" : null;

  return (
    <div
      role="dialog"
      aria-label={star.label}
      className={cn(
        // Telefon: karta od dołu na całą szerokość, nad paskiem nawigacji
        // (ten jest poza <main>, więc nic nie zasłania). Szeroko: pływa w rogu.
        "absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-t border-primary/25 bg-black/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_-12px_color-mix(in_oklab,var(--primary)_40%,transparent)] backdrop-blur-md",
        "@min-[900px]:inset-x-auto @min-[900px]:bottom-4 @min-[900px]:right-4 @min-[900px]:w-[380px] @min-[900px]:rounded-xl @min-[900px]:border",
        expanded ? "max-h-[85%]" : "max-h-[55%] @min-[900px]:max-h-[70%]",
      )}
    >
      <button
        type="button"
        aria-label={expanded ? "Zwiń kartę" : "Rozwiń kartę"}
        onClick={() => setExpanded((e) => !e)}
        className="flex h-6 w-full shrink-0 items-center justify-center @min-[900px]:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-primary/40" />
      </button>

      <div className="flex shrink-0 items-start gap-2 px-4 pb-2 @min-[900px]:pt-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[star.type])} />
            <span className="truncate">
              {TYPE_LABEL[star.type]}
              {clusterName ? ` · ${clusterName}` : ""} · {relativeAge(star.createdAt)}
            </span>
          </p>
          <h2 className="mt-1 break-words text-base font-semibold leading-snug text-foreground">
            {detail?.title || star.label}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Zamknij"
          onClick={onClose}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-primary/70 hover:text-primary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3">
        {isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Wczytuję…</p>
        ) : detail && detail.body === null && !detail.title ? (
          <p className="font-mono text-xs text-muted-foreground">
            Ten element został usunięty — zniknie z mapy przy następnym odświeżeniu.
          </p>
        ) : (
          <>
            {detail?.body && (
              <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {detail.body}
              </p>
            )}
            {detail?.meta && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {detail.meta}
              </p>
            )}
            {detail && detail.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-sm border border-primary/20 px-1.5 py-0.5 font-mono text-[10px] text-primary/80"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {star.provisional && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            Nowa gwiazda — miejsce wstępne, dokładne po nocnym przeliczeniu.
          </p>
        )}

        {neighbors.length > 0 && (
          <div className="mt-3">
            <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
              Najbliżej w Mózgu
            </p>
            <div className="mt-1.5 flex flex-col">
              {neighbors.map(({ index, star: n }) => (
                <button
                  key={starKey(n)}
                  type="button"
                  onClick={() => onPick(index)}
                  className="flex min-h-10 items-center gap-2 border-b border-primary/10 text-left last:border-b-0"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TYPE_DOT[n.type])} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
                    {n.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-primary/15 px-4 py-2.5">
        {canFly && (
          <button
            type="button"
            onClick={onFly}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            <Crosshair className="h-4 w-4" /> Przybliż
          </button>
        )}
        {sourceLink && (
          <Link
            to={sourceLink}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            <ExternalLink className="h-4 w-4" />
            {star.type === "note" ? "Notatki" : "Dokumenty"}
          </Link>
        )}
        <button
          type="button"
          onClick={onShowInStructure}
          aria-label="Pokaż tabelę w trybie Struktura"
          className="flex h-10 w-12 shrink-0 items-center justify-center rounded-md border border-primary/30 text-primary hover:bg-primary/10"
        >
          <Database className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function BrainList({
  stars,
  clusters,
  visibleTypes,
  onlyIndices,
  selected,
  onSelect,
  topInset,
}: {
  stars: BrainStar[];
  clusters: BrainCluster[];
  visibleTypes: ReadonlySet<BrainSourceType>;
  /** Wyniki wyszukiwania; null = wszystko. */
  onlyIndices: number[] | null;
  selected: number | null;
  onSelect: (i: number) => void;
  /** Wysokość górnego paska — lista zaczyna się pod nim. */
  topInset: number;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const groups = useMemo(() => {
    const allowed = onlyIndices ? new Set(onlyIndices) : null;
    const byCluster = new Map<number, number[]>();
    stars.forEach((s, i) => {
      if (!visibleTypes.has(s.type) || (allowed && !allowed.has(i))) return;
      const c = s.cluster ?? -1;
      const list = byCluster.get(c) ?? [];
      list.push(i);
      byCluster.set(c, list);
    });
    const named = clusters
      .filter((c) => byCluster.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, items: byCluster.get(c.id)! }));
    const rest = byCluster.get(-1);
    if (rest) named.push({ id: -1, name: "Bez gromady", items: rest });
    for (const g of named) {
      g.items.sort((a, b) => stars[b].createdAt.localeCompare(stars[a].createdAt));
    }
    return named;
  }, [stars, clusters, visibleTypes, onlyIndices]);

  const searching = onlyIndices !== null;

  return (
    <div
      className="no-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden px-3 pb-[45%] @min-[640px]:px-4"
      style={{ paddingTop: (topInset || 120) + 4 }}
    >
      {groups.length === 0 && (
        <p className="mt-6 text-center font-mono text-xs text-muted-foreground">Nic tu nie ma.</p>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {groups.map((g) => {
          const isOpen = searching || open.has(g.id);
          return (
            <section key={g.id} className="rounded-lg border border-primary/20 bg-black/40">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
                className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate font-display text-xs uppercase tracking-widest text-primary">
                  {g.name}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {g.items.length}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-primary/60 transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              {isOpen && (
                <ul className="border-t border-primary/10">
                  {g.items.map((i) => {
                    const s = stars[i];
                    return (
                      <li key={starKey(s)}>
                        <button
                          type="button"
                          onClick={() => onSelect(i)}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left",
                            selected === i ? "bg-primary/15" : "hover:bg-primary/5",
                          )}
                        >
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_DOT[s.type])} />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                            {s.label}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {relativeAge(s.createdAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function EmptyBrain({ hasLayout }: { hasLayout: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-primary/25 bg-black/50 p-5 text-center backdrop-blur-md">
        <Brain className="mx-auto h-8 w-8 text-primary" strokeWidth={1.25} />
        <h1 className="mt-3 font-display text-sm uppercase tracking-[0.3em] text-primary">
          Mózg jest pusty
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">
          {hasLayout
            ? "Ostatnie przeliczenie nie znalazło żadnej notatki, wspomnienia ani dokumentu z opisem semantycznym."
            : "Mapa jeszcze nie powstała — nocne przeliczenie układa ją o 03:40."}{" "}
          Gwiazdy pojawiają się z notatek, wspomnień, które zapisuje J.A.R.V.I.S., i wgranych
          dokumentów.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            to="/notes"
            className="flex h-10 items-center rounded-md border border-primary/30 px-4 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            Dodaj notatkę
          </Link>
          <Link
            to="/documents"
            className="flex h-10 items-center rounded-md border border-primary/30 px-4 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            Wgraj dokument
          </Link>
        </div>
      </div>
    </div>
  );
}
