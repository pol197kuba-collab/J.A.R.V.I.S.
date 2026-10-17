// Mózg 3D — tryb STRUKTURA: mapa tabel bazy (PLAN.md, S1.4).
//
// Ten sam układ co WIEDZA: u góry przełącznik trybu, wyszukiwarka tabel
// i legenda modułów (filtr), scena albo LISTA, karta od dołu. Karta tabeli:
// kolumny, powiązania (tapnięcie przelatuje do tabeli), polityki RLS i
// podgląd danych — wyłącznie własne wiersze (RLS), bez tabel z sekretami.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  ChevronDown,
  Crosshair,
  Database,
  KeyRound,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fold } from "@/lib/brain/scene";
import {
  layoutSchema,
  MODULES,
  SENSITIVE_TABLES,
  tableModule,
  type ModuleId,
  type SchemaTable,
} from "@/lib/brain/structure";
import { getSchemaMap, previewTable } from "@/lib/brain/structure.functions";
import { SheetFrame } from "./BrainPanels";
import { CenterNote, KindSwitch, ModeToggle } from "./brainUi";
import {
  SHEET_SIDE_MIN,
  SHEET_VIEW_SHIFT,
  useBrainMode,
  useElementSize,
  type BrainKind,
} from "./hooks";
import type { StructureNode } from "./StructureScene";

const StructureScene = lazy(() =>
  import("./StructureScene").then((m) => ({ default: m.StructureScene })),
);

const DOT: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((m) => [m.id, m.dot]),
) as Record<ModuleId, string>;
const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((m) => [m.id, m.label]),
) as Record<ModuleId, string>;
/** Tabele, które mają swoje gwiazdy w trybie WIEDZA. */
const KNOWLEDGE_TABLES = new Set(["memories", "notes", "documents"]);
/** Powyżej tej szerokości etykiety wszystkich tabel się mieszczą. */
const ALL_LABELS_MIN = 900;

export function StructureView({
  kind,
  onKindChange,
  initialTable,
}: {
  kind: BrainKind;
  onKindChange: (k: BrainKind) => void;
  /** Tabela do zaznaczenia po wejściu (przejście z karty gwiazdy). */
  initialTable: string | null;
}) {
  const fetchMap = useServerFn(getSchemaMap);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["brain", "schema"],
    queryFn: () => fetchMap(),
    staleTime: 5 * 60_000,
  });
  const { webgl, mode, setMode, effectiveMode } = useBrainMode();
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>();
  const [toolbarRef, toolbarSize] = useElementSize<HTMLDivElement>();

  const tables = useMemo(() => data?.tables ?? [], [data]);
  const nodes: StructureNode[] = useMemo(() => {
    const withModule = tables.map((t) => ({ name: t.name, module: tableModule(t.name) }));
    const pos = layoutSchema(
      withModule,
      (data?.foreign_keys ?? []).map((f) => ({ from: f.table, to: f.ref_table })),
    );
    return tables.map((t, i) => {
      const [x, y, z] = pos.get(t.name) ?? [0, 0, 0];
      return { name: t.name, module: withModule[i].module, rows: t.rows_estimate, x, y, z };
    });
  }, [tables, data]);
  const indexByName = useMemo(() => new Map(tables.map((t, i) => [t.name, i])), [tables]);
  const edges = useMemo(
    () =>
      (data?.foreign_keys ?? [])
        .map((f) => [indexByName.get(f.table), indexByName.get(f.ref_table)] as const)
        .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined)
        .map(([a, b]) => [a, b] as [number, number]),
    [data, indexByName],
  );

  const [visibleModules, setVisibleModules] = useState<ReadonlySet<ModuleId>>(
    () => new Set(MODULES.map((m) => m.id)),
  );
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(initialTable);
  const [focus, setFocus] = useState<{ index: number; nonce: number } | null>(null);
  const selected = selectedName === null ? null : (indexByName.get(selectedName) ?? null);

  // Przejście z karty gwiazdy: zaznacz i przyleć, gdy mapa się wczyta.
  useEffect(() => {
    if (!initialTable) return;
    const i = indexByName.get(initialTable);
    if (i !== undefined) setFocus({ index: i, nonce: Date.now() });
  }, [initialTable, indexByName]);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return tables
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => visibleModules.has(tableModule(t.name)))
      .filter(
        ({ t }) => fold(t.name).includes(q) || t.columns.some((c) => fold(c.name).includes(q)),
      )
      .sort((a, b) => Number(!fold(a.t.name).includes(q)) - Number(!fold(b.t.name).includes(q)))
      .map(({ i }) => i);
  }, [tables, query, visibleModules]);
  const highlighted = useMemo(() => new Set(results), [results]);

  const counts = useMemo(() => {
    const c = new Map<ModuleId, number>();
    for (const t of tables) c.set(tableModule(t.name), (c.get(tableModule(t.name)) ?? 0) + 1);
    return c;
  }, [tables]);

  const select = (i: number | null, fly = false) => {
    setSelectedName(i === null ? null : tables[i].name);
    if (fly && i !== null) setFocus({ index: i, nonce: Date.now() });
  };

  const toggleModule = (m: ModuleId) =>
    setVisibleModules((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next.size === 0 ? prev : next;
    });

  const narrow = rootSize.width > 0 && rootSize.width < SHEET_SIDE_MIN;

  return (
    <div
      ref={rootRef}
      className="relative h-[calc(100dvh-3rem)] min-h-[480px] w-full overflow-hidden bg-background portrait:h-full portrait:min-h-0 landscape:max-md:h-full landscape:max-md:min-h-0 short:h-full short:min-h-0"
    >
      {isLoading ? (
        <CenterNote icon={<Loader2 className="h-5 w-5 animate-spin" />}>
          Czytam schemat bazy…
        </CenterNote>
      ) : isError ? (
        <CenterNote icon={<Database className="h-5 w-5" />}>
          Nie udało się wczytać schematu.{" "}
          <button className="underline" onClick={() => refetch()}>
            Spróbuj ponownie
          </button>
        </CenterNote>
      ) : effectiveMode === "3d" ? (
        <Suspense
          fallback={
            <CenterNote icon={<Loader2 className="h-5 w-5 animate-spin" />}>
              Uruchamiam scenę…
            </CenterNote>
          }
        >
          <StructureScene
            nodes={nodes}
            edges={edges}
            visibleModules={visibleModules}
            selected={selected}
            highlighted={highlighted}
            focus={focus}
            onSelect={(i) => select(i)}
            onFocus={(i) => setFocus({ index: i, nonce: Date.now() })}
            viewShift={selected !== null && narrow ? SHEET_VIEW_SHIFT : 0}
            allLabels={!narrow}
          />
        </Suspense>
      ) : (
        <TableList
          tables={tables}
          visibleModules={visibleModules}
          onlyIndices={query.trim() ? results : null}
          selected={selected}
          onSelect={(i) => select(i)}
          topInset={toolbarSize.height}
        />
      )}

      <div
        ref={toolbarRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 @min-[640px]:p-4"
      >
        <KindSwitch kind={kind} onChange={onKindChange} />
        {tables.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <div className="pointer-events-auto relative min-w-0 flex-1 @min-[640px]:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary/60" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuery("");
                    if (e.key === "Enter" && results[0] !== undefined) {
                      select(results[0], true);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="Szukaj tabeli albo kolumny…"
                  aria-label="Szukaj tabeli"
                  className="h-11 w-full rounded-lg border border-primary/25 bg-black/60 pl-9 pr-10 font-mono text-base text-foreground placeholder:text-muted-foreground/70 backdrop-blur-md outline-none focus:border-primary/60 @min-[640px]:h-10 @min-[640px]:text-sm"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Wyczyść wyszukiwanie"
                    onClick={() => setQuery("")}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-primary/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {webgl && <ModeToggle mode={mode} onChange={setMode} />}
            </div>
            <div className="no-scrollbar pointer-events-auto -mx-3 flex gap-1 overflow-x-auto overflow-y-hidden px-3 @min-[640px]:mx-0 @min-[640px]:flex-wrap @min-[640px]:px-0">
              {MODULES.filter((m) => (counts.get(m.id) ?? 0) > 0).map((m) => {
                const on = visibleModules.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleModule(m.id)}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-display text-[10px] uppercase tracking-wider backdrop-blur-md",
                      on
                        ? "border-primary/30 bg-black/60 text-foreground"
                        : "border-primary/10 bg-black/40 text-muted-foreground opacity-60",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", m.dot, !on && "opacity-40")} />
                    {m.label}
                    <span className="font-mono text-muted-foreground">{counts.get(m.id)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {selected !== null && tables[selected] && (
        <TableSheet
          table={tables[selected]}
          foreignKeys={data?.foreign_keys ?? []}
          canFly={effectiveMode === "3d"}
          onClose={() => setSelectedName(null)}
          onFly={() => setFocus({ index: selected, nonce: Date.now() })}
          onGo={(name) => {
            const i = indexByName.get(name);
            if (i !== undefined) select(i, effectiveMode === "3d");
          }}
          onShowKnowledge={() => onKindChange("knowledge")}
        />
      )}
    </div>
  );
}

function TableSheet({
  table,
  foreignKeys,
  canFly,
  onClose,
  onFly,
  onGo,
  onShowKnowledge,
}: {
  table: SchemaTable;
  foreignKeys: { table: string; column: string; ref_table: string; ref_column: string }[];
  canFly: boolean;
  onClose: () => void;
  onFly: () => void;
  onGo: (name: string) => void;
  onShowKnowledge: () => void;
}) {
  const fetchPreview = useServerFn(previewTable);
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => setShowPreview(false), [table.name]);
  const preview = useQuery({
    queryKey: ["brain", "preview", table.name],
    queryFn: () => fetchPreview({ data: { table: table.name } }),
    enabled: showPreview,
    staleTime: 30_000,
  });
  const sensitive = SENSITIVE_TABLES.has(table.name);
  const outgoing = foreignKeys.filter((f) => f.table === table.name);
  const incoming = foreignKeys.filter((f) => f.ref_table === table.name && f.table !== table.name);
  const module = tableModule(table.name);

  const section = (label: string) => (
    <p className="mt-4 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
      {label}
    </p>
  );

  return (
    <SheetFrame
      label={`Tabela ${table.name}`}
      title={
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[module])} />
          <span className="truncate font-mono text-sm text-foreground">{table.name}</span>
        </span>
      }
      onClose={onClose}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {MODULE_LABEL[module]} ·{" "}
        {table.rows_estimate < 0 ? "liczba wierszy nieznana" : `~${table.rows_estimate} wierszy`} ·{" "}
        {table.columns.length} kolumn
      </p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1.5 text-xs",
          table.rls ? "text-success" : "text-warning",
        )}
      >
        {table.rls ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {table.rls
          ? `RLS włączone · ${table.policies.length} ${table.policies.length === 1 ? "polityka" : "polityk"}`
          : "RLS wyłączone"}
      </p>

      <div className="mt-3 flex gap-2">
        {canFly && (
          <button
            type="button"
            onClick={onFly}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            <Crosshair className="h-4 w-4" /> Przybliż
          </button>
        )}
        {KNOWLEDGE_TABLES.has(table.name) && (
          <button
            type="button"
            onClick={onShowKnowledge}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            <Sparkles className="h-4 w-4" /> Gwiazdy
          </button>
        )}
      </div>

      {section("Kolumny")}
      <ul className="mt-1">
        {table.columns.map((c) => (
          <li
            key={c.name}
            className="flex min-h-9 items-center gap-2 border-b border-primary/10 py-1.5"
          >
            {c.pk ? (
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-reactor" aria-label="klucz główny" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
              {c.name}
            </span>
            <span className="min-w-0 max-w-[45%] truncate font-mono text-[10px] text-muted-foreground">
              {c.type}
              {c.nullable ? "" : " · not null"}
            </span>
          </li>
        ))}
      </ul>

      {(outgoing.length > 0 || incoming.length > 0) && (
        <>
          {section("Powiązania")}
          <ul className="mt-1">
            {[
              ...outgoing.map((f) => ({ f, out: true })),
              ...incoming.map((f) => ({ f, out: false })),
            ].map(({ f, out }) => {
              const other = out ? f.ref_table : f.table;
              return (
                <li key={`${out}:${f.table}.${f.column}->${f.ref_table}`}>
                  <button
                    type="button"
                    onClick={() => onGo(other)}
                    className="flex min-h-10 w-full items-center gap-2 border-b border-primary/10 py-1.5 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
                      {out
                        ? `${f.column} → ${f.ref_table}.${f.ref_column}`
                        : `${f.table}.${f.column} → ${f.ref_column}`}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {table.policies.length > 0 && (
        <>
          {section("Polityki RLS")}
          <ul className="mt-1">
            {table.policies.map((p) => (
              <li
                key={p.name}
                className="flex min-h-9 items-center gap-2 border-b border-primary/10 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{p.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {p.command}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {section("Dane")}
      {sensitive ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Tabela z kluczami i sekretami — pokazuję tylko strukturę, nigdy dane.
        </p>
      ) : !showPreview ? (
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="mt-1.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-primary/30 font-display text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
        >
          <ChevronDown className="h-4 w-4" /> Pokaż moje wiersze
        </button>
      ) : preview.isLoading ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">Wczytuję…</p>
      ) : preview.data?.error ? (
        <p className="mt-1 text-xs text-warning">{preview.data.error}</p>
      ) : (
        <PreviewRows
          rows={preview.data?.rows ?? []}
          columns={preview.data?.columns ?? []}
          ownCount={preview.data?.ownCount ?? null}
          hidden={preview.data?.hiddenColumns ?? []}
        />
      )}
    </SheetFrame>
  );
}

/** Wiersze jako karty klucz–wartość: na telefonie bez poziomego przewijania. */
function PreviewRows({
  rows,
  columns,
  ownCount,
  hidden,
}: {
  rows: Record<string, string>[];
  columns: string[];
  ownCount: number | null;
  hidden: string[];
}) {
  return (
    <div className="mt-1.5">
      <p className="font-mono text-[10px] text-muted-foreground">
        {ownCount === null ? "" : `Twoich wierszy: ${ownCount}. `}
        {rows.length > 0
          ? `Pokazuję ${rows.length} najnowszych.`
          : "Brak wierszy widocznych dla Ciebie."}
        {hidden.length > 0 ? ` Pominięte: ${hidden.join(", ")}.` : ""}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((r, i) => (
          <dl key={i} className="rounded-md border border-primary/15 bg-black/40 px-3 py-2 text-xs">
            {columns.map((c) => (
              <div key={c} className="flex min-w-0 gap-2 py-0.5">
                <dt className="w-[38%] shrink-0 truncate font-mono text-muted-foreground">{c}</dt>
                <dd className="min-w-0 flex-1 break-words text-foreground/90">{r[c]}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}

function TableList({
  tables,
  visibleModules,
  onlyIndices,
  selected,
  onSelect,
  topInset,
}: {
  tables: SchemaTable[];
  visibleModules: ReadonlySet<ModuleId>;
  onlyIndices: number[] | null;
  selected: number | null;
  onSelect: (i: number) => void;
  topInset: number;
}) {
  const [open, setOpen] = useState<Set<ModuleId>>(() => new Set());
  const groups = useMemo(() => {
    const allowed = onlyIndices ? new Set(onlyIndices) : null;
    return MODULES.filter((m) => visibleModules.has(m.id))
      .map((m) => ({
        module: m,
        items: tables
          .map((t, i) => ({ t, i }))
          .filter(({ t, i }) => tableModule(t.name) === m.id && (!allowed || allowed.has(i))),
      }))
      .filter((g) => g.items.length > 0);
  }, [tables, visibleModules, onlyIndices]);

  return (
    <div
      className="no-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden px-3 pb-[45%] @min-[640px]:px-4"
      style={{ paddingTop: (topInset || 160) + 4 }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {groups.map(({ module: m, items }) => {
          const isOpen = onlyIndices !== null || open.has(m.id);
          return (
            <section key={m.id} className="rounded-lg border border-primary/20 bg-black/40">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", m.dot)} />
                <span className="min-w-0 flex-1 truncate font-display text-xs uppercase tracking-widest text-primary">
                  {m.label}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{items.length}</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-primary/60 transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              {isOpen && (
                <ul className="border-t border-primary/10">
                  {items.map(({ t, i }) => (
                    <li key={t.name}>
                      <button
                        type="button"
                        onClick={() => onSelect(i)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left",
                          selected === i ? "bg-primary/15" : "hover:bg-primary/5",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground/90">
                          {t.name}
                        </span>
                        {!t.rls && <Lock className="h-3.5 w-3.5 shrink-0 text-warning" />}
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {t.rows_estimate < 0 ? "?" : `~${t.rows_estimate}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
