import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, X } from "lucide-react";
import {
  listAgentTools,
  resetAgentStatusFn,
  type AgentSummary,
} from "@/lib/agents/runtime.functions";
import { FORCED_TOOLS_BY_SLUG } from "@/lib/constants/agentSlugs";

// Left-side twin of HudOverlay's "Recent Network Assignments" panel — same
// frame/header/scroll treatment, but a static registry of the agent team
// instead of a live event feed. Tool lists are the union of DB-enabled
// agent_tools bindings and FORCED_TOOLS_BY_SLUG (in-memory forced tools like
// delegate_to_agent never have a `tools` row, so they'd otherwise be
// invisible here even though the agent always has them at runtime).
const MAX_INLINE_TOOLS = 2;

// Both this and HudOverlay's twin panel default COLLAPSED — a small
// left/right icon button over the 3D canvas — because at 220-260px wide
// EACH, having both open at once on anything narrower than ~600px makes
// them collide with each other and with the canvas's own node labels.
// Tapping the button expands the full panel; tapping again (or the ✕)
// collapses it back.
export function AgentRegistryPanel({ agents }: { agents: AgentSummary[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open agent registry"
        className="pointer-events-auto absolute left-4 top-16 flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-black/60 px-2.5 py-1.5 shadow-[0_0_30px_-10px_rgba(77,216,255,0.5)] backdrop-blur-md transition hover:border-cyan-400/50 sm:left-6 sm:top-20"
      >
        <Users className="h-3 w-3 text-cyan-300" strokeWidth={1.5} />
        <span className="font-display text-[9px] uppercase tracking-[0.25em] text-cyan-300/90">
          Registry ({agents.length})
        </span>
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute left-4 top-16 flex max-h-[50%] w-[220px] flex-col overflow-hidden rounded-lg border border-cyan-400/25 bg-black/60 shadow-[0_0_30px_-10px_rgba(77,216,255,0.5)] backdrop-blur-md sm:left-6 sm:top-20 sm:w-[260px]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-cyan-400/20 px-3 py-2">
        <Users className="h-3 w-3 text-cyan-300" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate font-display text-[9px] uppercase tracking-[0.25em] text-cyan-300/90">
          Agent Registry
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close agent registry"
          className="shrink-0 text-cyan-300/60 hover:text-cyan-300"
        >
          <X className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden p-2">
        {agents.length === 0 ? (
          <p className="px-1 py-2 font-mono text-[9px] uppercase tracking-widest text-white/30">
            ▸ no agents registered…
          </p>
        ) : (
          agents.map((agent) => <AgentRegistryRow key={agent.slug} agent={agent} />)
        )}
      </div>
    </div>
  );
}

/**
 * Przycisk odwieszenia — pojawia się TYLKO przy agencie opisanym jako zajęty.
 *
 * Powód, dla którego w ogóle istnieje: `agents.status` ustawia się na starcie
 * przebiegu, a zeruje na jego końcu — obie rzeczy w tym samym wywołaniu
 * serwera. Zerwane wywołanie (uśpiona karta na telefonie) nie wykona ani
 * jednej, ani drugiej, więc agent zostaje „zajęty" bez końca. Automat sprząta
 * to po dwudziestu minutach; ten przycisk jest dla człowieka, który patrzy na
 * kafel „ACTIVE TASK" i wie już teraz, że nic się tam nie dzieje.
 *
 * Widoczny warunkowo, bo przy bezczynnym agencie nie miałby co robić — a
 * przycisk, który zwykle nic nie znaczy, uczy się go ignorować.
 */
function UnwedgeButton({ agent }: { agent: AgentSummary }) {
  const qc = useQueryClient();
  const reset = useServerFn(resetAgentStatusFn);

  const mutation = useMutation({
    mutationFn: () => reset({ data: { slug: agent.slug } }),
    onSuccess: (result) => {
      // Jeden prefiks pokrywa OBA zapytania, które to widzą: ["agents","list"]
      // (rejestr i matryca 3D) oraz ["agents","flow"] (drzewo delegacji).
      // Kafel „ACTIVE TASK" czyta pierwsze, krawędzie drugie — odświeżenie
      // tylko jednego zostawiłoby drugie świecące.
      void qc.invalidateQueries({ queryKey: ["agents"] });
      if (result.errors.length > 0) {
        toast("Nie udało się odwiesić", { description: result.errors.join("; ") });
        return;
      }
      toast(`${agent.name}: odwieszony`, {
        description:
          result.closedRuns > 0
            ? `Domknięto ${result.closedRuns} przerwanych przebiegów.`
            : "Status wyczyszczony.",
      });
    },
    onError: (err: unknown) =>
      toast("Nie udało się odwiesić", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  if (agent.status !== "busy") return null;

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      title="Wyczyść status „zajęty” i domknij przerwane przebiegi"
      className="font-display shrink-0 rounded border border-[color:var(--warning)]/50 px-1.5 py-0.5 text-[7px] uppercase tracking-[0.2em] text-[color:var(--warning)] transition hover:bg-[color:var(--warning)]/10 disabled:opacity-40"
    >
      {mutation.isPending ? "…" : "odwieś"}
    </button>
  );
}

function AgentRegistryRow({ agent }: { agent: AgentSummary }) {
  const fetchTools = useServerFn(listAgentTools);
  const { data: tools = [] } = useQuery({
    queryKey: ["agent-tools", agent.slug],
    queryFn: () => fetchTools({ data: { agentSlug: agent.slug } }),
    staleTime: 30_000,
  });

  const dbEnabled = tools.filter((t) => t.enabledForAgent && t.globallyEnabled).map((t) => t.slug);
  const forced = FORCED_TOOLS_BY_SLUG[agent.slug] ?? [];
  const toolSlugs = Array.from(new Set([...dbEnabled, ...forced]));

  const visible = toolSlugs.slice(0, MAX_INLINE_TOOLS);
  const remaining = toolSlugs.length - visible.length;
  const toolsLabel =
    toolSlugs.length === 0
      ? "no tools bound"
      : remaining > 0
        ? `${visible.join(", ")}, +${remaining} więcej`
        : visible.join(", ");

  return (
    <div
      className="border-l-2 border-cyan-400/40 pl-2"
      title={toolSlugs.length > 0 ? toolSlugs.join(", ") : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="line-clamp-1 min-w-0 flex-1 font-display text-[10px] uppercase tracking-[0.15em] text-white/90">
          {agent.name}
        </p>
        <UnwedgeButton agent={agent} />
      </div>
      <p className="line-clamp-1 font-mono text-[8px] leading-snug text-cyan-300/70">
        {agent.role ?? "—"}
      </p>
      <p className="line-clamp-1 font-mono text-[8px] leading-snug text-white/40">{toolsLabel}</p>
    </div>
  );
}
