// Zakładka NARZĘDZIA w Agent Hub — jedno miejsce, w którym widać, czym
// posługuje się każdy agent, i gdzie się to przełącza. Wiersz = narzędzie
// (kategoria, ryzyko, obca treść, użycie z 7 dni), pod nim przełączniki
// agentów. Logika: src/lib/agents/toolMatrix.ts (czysta, testowana).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { audio } from "@/lib/audio/AudioEngine";
import { setAgentToolEnabled } from "@/lib/agents/runtime.functions";
import { getToolMatrix } from "@/lib/agents/toolMatrix.functions";
import {
  rowMatches,
  toolCountFor,
  type CellState,
  type MatrixRow,
  type ToolMatrix,
  type ToolRiskKind,
} from "@/lib/agents/toolMatrix";
import { cn } from "@/lib/utils";

export const TOOL_MATRIX_KEY = ["agent-tools", "matrix"] as const;

const RISK: Record<ToolRiskKind, { label: string; title: string; color: string }> = {
  read: { label: "odczyt", title: "Tylko czyta dane.", color: "var(--muted-foreground)" },
  write: { label: "zapis", title: "Zmienia Twoje dane w aplikacji.", color: "var(--primary)" },
  external: {
    label: "wymaga zgody",
    title: "Skutek poza aplikacją albo nieodwracalny — po obcej treści agent pyta o potwierdzenie.",
    color: "var(--warning)",
  },
};

const chipClass =
  "font-display inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed";

function cellLook(state: CellState): { className: string; label: string } {
  switch (state) {
    case "on":
      return { className: "border-success/60 bg-success/10 text-success", label: "włączone" };
    case "forced":
      return {
        className: "border-primary/50 bg-primary/10 text-primary",
        label: "zawsze włączone (wymagane przez agenta)",
      };
    case "blocked":
      return {
        className: "border-muted-foreground/20 text-muted-foreground/40",
        label: "niedostępne",
      };
    default:
      return {
        className: "border-muted-foreground/30 text-muted-foreground hover:text-foreground",
        label: "wyłączone",
      };
  }
}

export function ToolMatrixPanel({
  index = 1,
  initialAgent = null,
}: {
  index?: number;
  initialAgent?: string | null;
}) {
  const qc = useQueryClient();
  const fetchMatrix = useServerFn(getToolMatrix);
  const persist = useServerFn(setAgentToolEnabled);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | null>(initialAgent);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: TOOL_MATRIX_KEY,
    queryFn: () => fetchMatrix(),
  });

  const toggle = useMutation({
    mutationFn: (v: { agentSlug: string; toolId: string; enabled: boolean }) =>
      persist({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: TOOL_MATRIX_KEY });
      const prev = qc.getQueryData<ToolMatrix>(TOOL_MATRIX_KEY);
      if (prev) {
        qc.setQueryData<ToolMatrix>(TOOL_MATRIX_KEY, {
          ...prev,
          groups: prev.groups.map((g) => ({
            ...g,
            rows: g.rows.map((r) =>
              r.id === v.toolId
                ? { ...r, cells: { ...r.cells, [v.agentSlug]: v.enabled ? "on" : "off" } }
                : r,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TOOL_MATRIX_KEY, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["agent-tools"] });
      void qc.invalidateQueries({ queryKey: ["agent"] });
    },
  });

  const groups = useMemo(
    () =>
      (data?.groups ?? [])
        .map((g) => ({ ...g, rows: g.rows.filter((r) => rowMatches(r, query, agentFilter)) }))
        .filter((g) => g.rows.length > 0),
    [data, query, agentFilter],
  );
  const total = data?.groups.reduce((n, g) => n + g.rows.length, 0) ?? 0;

  const onCell = (row: MatrixRow, agentSlug: string) => {
    const state = row.cells[agentSlug];
    if (!row.id || (state !== "on" && state !== "off")) return;
    audio.playClick();
    toggle.mutate({ agentSlug, toolId: row.id, enabled: state === "off" });
  };

  return (
    <HudPanel index={index} title={`NARZĘDZIA AGENTÓW // ${total}`} className="p-5">
      <div className="mt-3 space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj narzędzia…"
          aria-label="Szukaj narzędzia"
          className="w-full border-b border-primary/40 bg-transparent px-1 py-1.5 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
        />
        {data && (
          <div role="group" aria-label="Pokaż narzędzia agenta" className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={agentFilter === null}
              onClick={() => setAgentFilter(null)}
              className={cn(
                chipClass,
                agentFilter === null
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-primary/30 text-primary/70",
              )}
            >
              Wszyscy
            </button>
            {data.agents.map((a) => (
              <button
                key={a.slug}
                type="button"
                aria-pressed={agentFilter === a.slug}
                onClick={() => setAgentFilter(agentFilter === a.slug ? null : a.slug)}
                className={cn(
                  chipClass,
                  agentFilter === a.slug
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-primary/30 text-primary/70",
                )}
              >
                {a.name} · {toolCountFor(data, a.slug)}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Kliknij agenta pod narzędziem, żeby mu je włączyć lub wyłączyć.{" "}
          <span className="text-primary">Kłódka</span> — narzędzie wymagane przez agenta, zawsze
          włączone. <span style={{ color: RISK.external.color }}>Wymaga zgody</span> — po treści z
          internetu lub dokumentu agent pyta przed użyciem.
        </p>
      </div>

      {isLoading && (
        <p className="font-display mt-4 text-xs uppercase tracking-widest text-muted-foreground">
          ▸ Wczytuję narzędzia…
        </p>
      )}
      {error && (
        <p className="mt-4 text-xs" style={{ color: "var(--destructive)" }}>
          ✕ {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {toggle.error && (
        <p className="mt-4 text-xs" style={{ color: "var(--destructive)" }}>
          ✕ Nie zapisano zmiany: {toggle.error.message}
        </p>
      )}
      {data && groups.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">Nic nie pasuje do filtra.</p>
      )}

      <div className="mt-5 space-y-6">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="font-display text-[11px] uppercase tracking-[0.3em] text-primary/80">
              {g.label}
            </h3>
            <ul className="mt-2">
              {g.rows.map((row, i) => {
                const open = openSlug === row.slug;
                return (
                  <li key={row.slug} className={cn("py-3", i > 0 && "border-t border-primary/15")}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenSlug(open ? null : row.slug)}
                      className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-left"
                    >
                      <span className="min-w-0 break-words text-sm text-foreground">
                        {row.name}
                      </span>
                      {row.risk && (
                        <span
                          title={RISK[row.risk].title}
                          className="font-display text-[9px] uppercase tracking-[0.2em]"
                          style={{ color: RISK[row.risk].color }}
                        >
                          {RISK[row.risk].label}
                        </span>
                      )}
                      {row.untrusted && (
                        <span
                          title="Wynik niesie treść spoza Ciebie (strony, dokumenty) — może zawierać wstrzyknięte polecenia."
                          className="font-display text-[9px] uppercase tracking-[0.2em] text-warning/80"
                        >
                          obca treść
                        </span>
                      )}
                      {!row.globallyEnabled && !row.missingInCode && (
                        <span className="font-display text-[9px] uppercase tracking-[0.2em] text-destructive">
                          wyłączone globalnie
                        </span>
                      )}
                      {row.missingInCode && (
                        <span className="font-display text-[9px] uppercase tracking-[0.2em] text-destructive">
                          brak w kodzie
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                        7 dni: {row.usage7d}
                      </span>
                    </button>
                    {open && (
                      <div className="mt-1 min-w-0 space-y-1">
                        {row.description && (
                          <p className="break-words text-xs text-muted-foreground">
                            {row.description}
                          </p>
                        )}
                        <p className="break-all font-mono text-[10px] text-muted-foreground/60">
                          {row.slug}
                        </p>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data!.agents.map((a) => {
                        const state = row.cells[a.slug];
                        const look = cellLook(state);
                        const locked = state === "forced" || state === "blocked";
                        return (
                          <button
                            key={a.slug}
                            type="button"
                            aria-pressed={state === "on" || state === "forced"}
                            disabled={locked || toggle.isPending}
                            title={`${a.name}: ${look.label}`}
                            onClick={() => onCell(row, a.slug)}
                            className={cn(chipClass, look.className)}
                          >
                            {state === "forced" && <Lock className="h-2.5 w-2.5" strokeWidth={2} />}
                            {a.name}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </HudPanel>
  );
}
