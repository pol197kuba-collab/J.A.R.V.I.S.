import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { getSchemaSnapshot, type SchemaSnapshot } from "@/lib/schema/schema.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/schema")({
  head: () => ({
    meta: [
      { title: "JARVIS // Schema Explorer" },
      { name: "description", content: "Database topology — tables, columns, relations and access policies." },
    ],
  }),
  component: SchemaExplorer,
});

type ViewMode = "detail" | "graph";

function SchemaExplorer() {
  const fetchSchema = useServerFn(getSchemaSnapshot);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["schema_snapshot"],
    queryFn: () => fetchSchema(),
    staleTime: 30_000,
  });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("detail");

  const tables = data?.tables ?? [];
  const filtered = useMemo(
    () => tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter],
  );
  const activeName = selected ?? filtered[0]?.name ?? null;
  const active = tables.find((t) => t.name === activeName) ?? null;

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="TOPOLOGY // DATABASE" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SCHEMA EXPLORER</h1>
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {tables.length} TABLES // {data?.foreign_keys.length ?? 0} RELATIONS //{" "}
            {data?.policies.length ?? 0} POLICIES {isFetching ? "// syncing…" : ""}
          </p>
          <div className="flex items-center gap-1 border border-primary/40">
            {(["detail", "graph"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "font-display px-3 py-1 text-[10px] uppercase tracking-widest transition",
                  view === v
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="font-display border border-primary/50 bg-primary/5 px-2 py-1 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/15"
          >
            ▸ Refresh
          </button>
        </div>
      </HudPanel>

      {isLoading && (
        <HudPanel index={1} title="LOADING" className="p-5">
          <p className="text-muted-foreground">▸ scanning database topology…</p>
        </HudPanel>
      )}
      {error && (
        <HudPanel index={1} title="ERROR" className="p-5">
          <p style={{ color: "var(--destructive)" }}>
            ✕ {error instanceof Error ? error.message : String(error)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Access denied? This module is restricted to admin accounts.
          </p>
        </HudPanel>
      )}

      {data && view === "detail" && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <HudPanel index={1} title="TABLES // INDEX" className="p-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter…"
              className="font-display w-full border border-primary/30 bg-black/40 px-2 py-1 text-[11px] uppercase tracking-widest text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
            <div className="mt-2 max-h-[70vh] space-y-1 overflow-y-auto pr-1">
              {filtered.map((t) => {
                const isActive = t.name === activeName;
                const policyCount = data.policies.filter((p) => p.table === t.name).length;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setSelected(t.name)}
                    className={cn(
                      "font-display group flex w-full items-center justify-between border px-2 py-1.5 text-left text-[11px] uppercase tracking-widest transition",
                      isActive
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-primary/20 text-foreground/80 hover:border-primary/50 hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    <span>{t.name}</span>
                    <span className="text-[9px] text-muted-foreground">
                      {t.columns.length}c · {policyCount}p
                    </span>
                  </button>
                );
              })}
            </div>
          </HudPanel>

          <div className="space-y-6">
            {active && (
              <TableDetail
                snapshot={data}
                table={active}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>
      )}

      {data && view === "graph" && (
        <HudPanel index={1} title="RELATION MAP" className="p-5">
          <SchemaGraph snapshot={data} onSelect={(n) => { setSelected(n); setView("detail"); }} />
        </HudPanel>
      )}

      {data && data.enums.length > 0 && (
        <HudPanel index={2} title="ENUMS" className="p-5">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.enums.map((e) => (
              <div key={e.name} className="border border-primary/20 bg-black/30 p-3">
                <div className="font-display text-[11px] uppercase tracking-widest text-primary">
                  {e.name}
                </div>
                <div className="mt-1 font-mono text-xs text-foreground/80">
                  {e.values.join(" | ")}
                </div>
              </div>
            ))}
          </div>
        </HudPanel>
      )}
    </div>
  );
}

function TableDetail({
  snapshot,
  table,
  onSelect,
}: {
  snapshot: SchemaSnapshot;
  table: SchemaSnapshot["tables"][number];
  onSelect: (name: string) => void;
}) {
  const fks = snapshot.foreign_keys.filter((f) => f.table === table.name);
  const inbound = snapshot.foreign_keys.filter((f) => f.ref_table === table.name);
  const policies = snapshot.policies.filter((p) => p.table === table.name);

  return (
    <>
      <HudPanel index={1} title={`TABLE // ${table.name.toUpperCase()}`} className="p-4">
        <div className="mb-2 flex items-center gap-3 text-[10px] uppercase tracking-widest">
          <span className="text-muted-foreground">RLS</span>
          <span
            className="font-display"
            style={{ color: table.rls_enabled ? "var(--success)" : "var(--warning)" }}
          >
            {table.rls_enabled ? "▸ ENABLED" : "▸ DISABLED"}
          </span>
        </div>
        <div className="overflow-hidden border border-primary/20">
          <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(160px,1.5fr)_80px_1fr] gap-3 border-b border-primary/30 bg-primary/5 px-3 py-2 font-display text-[10px] uppercase tracking-widest text-primary/80">
            <span>COLUMN</span>
            <span>TYPE</span>
            <span>NULL</span>
            <span>DEFAULT</span>
          </div>
          {table.columns.map((c) => (
            <div
              key={c.name}
              className="grid grid-cols-[minmax(140px,1.2fr)_minmax(160px,1.5fr)_80px_1fr] gap-3 border-b border-primary/10 px-3 py-1.5 font-mono text-xs last:border-0"
            >
              <span className={cn("truncate", c.is_primary_key ? "text-primary" : "text-foreground")}>
                {c.is_primary_key && <span className="mr-1 text-primary">◆</span>}
                {c.name}
              </span>
              <span className="truncate text-foreground/80">{c.type}</span>
              <span className={c.nullable ? "text-muted-foreground" : "text-foreground/60"}>
                {c.nullable ? "yes" : "no"}
              </span>
              <span className="truncate text-muted-foreground">{c.default ?? "—"}</span>
            </div>
          ))}
        </div>
      </HudPanel>

      <HudPanel index={2} title="FOREIGN KEYS // OUTBOUND" className="p-4">
        {fks.length === 0 ? (
          <p className="text-xs text-muted-foreground">▸ no outbound relations</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {fks.map((f) => (
              <li key={f.constraint} className="flex items-center gap-2">
                <span className="text-foreground">{f.column}</span>
                <span className="text-primary">→</span>
                <button
                  type="button"
                  onClick={() => onSelect(f.ref_table)}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {f.ref_table}.{f.ref_column}
                </button>
              </li>
            ))}
          </ul>
        )}
      </HudPanel>

      {inbound.length > 0 && (
        <HudPanel index={3} title="FOREIGN KEYS // INBOUND" className="p-4">
          <ul className="space-y-1 font-mono text-xs">
            {inbound.map((f) => (
              <li key={f.constraint} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(f.table)}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {f.table}.{f.column}
                </button>
                <span className="text-primary">→</span>
                <span className="text-foreground">{f.ref_column}</span>
              </li>
            ))}
          </ul>
        </HudPanel>
      )}

      <HudPanel index={4} title={`POLICIES // RLS (${policies.length})`} className="p-4">
        {policies.length === 0 ? (
          <p className="text-xs text-muted-foreground">▸ no policies defined</p>
        ) : (
          <div className="space-y-2">
            {policies.map((p) => (
              <div key={p.name} className="border border-primary/20 bg-black/30 p-2">
                <div className="flex flex-wrap items-center gap-2 font-display text-[10px] uppercase tracking-widest">
                  <span className="text-primary">{p.name}</span>
                  <span className="border border-primary/40 px-1 text-primary/80">{p.command}</span>
                  <span className="text-muted-foreground">roles: {p.roles.join(", ") || "public"}</span>
                </div>
                {p.using && (
                  <div className="mt-1 font-mono text-[11px] text-foreground/80">
                    <span className="text-muted-foreground">USING </span>
                    {p.using}
                  </div>
                )}
                {p.with_check && (
                  <div className="mt-0.5 font-mono text-[11px] text-foreground/80">
                    <span className="text-muted-foreground">WITH CHECK </span>
                    {p.with_check}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </HudPanel>
    </>
  );
}

function SchemaGraph({
  snapshot,
  onSelect,
}: {
  snapshot: SchemaSnapshot;
  onSelect: (name: string) => void;
}) {
  const nodeW = 160;
  const nodeH = 44;
  const cols = 4;
  const gapX = 220;
  const gapY = 90;
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    snapshot.tables.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      map.set(t.name, { x: 40 + col * gapX, y: 30 + row * gapY });
    });
    return map;
  }, [snapshot.tables]);

  const rows = Math.ceil(snapshot.tables.length / cols);
  const width = 40 + cols * gapX;
  const height = 30 + rows * gapY + 20;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="min-w-full">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary)" />
          </marker>
        </defs>
        {snapshot.foreign_keys.map((f, i) => {
          const from = positions.get(f.table);
          const to = positions.get(f.ref_table);
          if (!from || !to) return null;
          const x1 = from.x + nodeW / 2;
          const y1 = from.y + nodeH / 2;
          const x2 = to.x + nodeW / 2;
          const y2 = to.y + nodeH / 2;
          return (
            <line
              key={`${f.constraint}-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--primary)"
              strokeOpacity="0.35"
              strokeWidth="1"
              markerEnd="url(#arrow)"
            />
          );
        })}
        {snapshot.tables.map((t) => {
          const p = positions.get(t.name)!;
          return (
            <g
              key={t.name}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(t.name)}
            >
              <rect
                width={nodeW}
                height={nodeH}
                fill="color-mix(in oklab, var(--primary) 10%, black)"
                stroke="var(--primary)"
                strokeOpacity="0.6"
              />
              <text
                x={nodeW / 2}
                y={nodeH / 2 - 2}
                textAnchor="middle"
                className="fill-primary font-display"
                style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" }}
              >
                {t.name}
              </text>
              <text
                x={nodeW / 2}
                y={nodeH / 2 + 12}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 9 }}
              >
                {t.columns.length} cols
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}