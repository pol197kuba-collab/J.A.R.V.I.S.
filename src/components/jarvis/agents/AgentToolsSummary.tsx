// Krótka lista narzędzi jednego agenta + przejście do zakładki NARZĘDZIA
// w Agent Hub, gdzie się je przełącza. Zastępuje dawne osobne panele
// przełączników w Ustawieniach i w szczegółach agenta.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { audio } from "@/lib/audio/AudioEngine";
import { listAgentTools } from "@/lib/agents/runtime.functions";
import { requestToolsTab } from "@/lib/agents/toolsTabBus";
import { FORCED_TOOLS_BY_SLUG } from "@/lib/constants/agentSlugs";

export function AgentToolsSummary({
  agentSlug,
  agentName,
  index = 2,
  usage7d,
}: {
  agentSlug: string;
  agentName: string;
  index?: number;
  /** Wywołania z 7 dni (szczegóły agenta je znają). */
  usage7d?: Record<string, number>;
}) {
  const fetchTools = useServerFn(listAgentTools);
  const { go, isTransitioning } = useHudNavigate();
  const { data: tools, error } = useQuery({
    queryKey: ["agent-tools", agentSlug],
    queryFn: () => fetchTools({ data: { agentSlug } }),
  });

  const enabled = (tools ?? []).filter((t) => t.enabledForAgent && t.globallyEnabled);
  const forced = FORCED_TOOLS_BY_SLUG[agentSlug] ?? [];
  const names = [
    ...enabled.map((t) => ({ key: t.slug, label: t.name })),
    ...forced
      .filter((slug) => !enabled.some((t) => t.slug === slug))
      .map((slug) => ({ key: slug, label: slug })),
  ];

  const manage = () => {
    if (isTransitioning) return;
    audio.playClick();
    requestToolsTab(agentSlug);
    go("/agent-hub");
  };

  return (
    <HudPanel index={index} title={`NARZĘDZIA // ${agentName}`} tone="quiet" className="p-5">
      <div className="mt-3 space-y-3">
        {error && (
          <p className="text-xs" style={{ color: "var(--destructive)" }}>
            ✕ {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {tools && names.length === 0 && (
          <p className="text-xs text-muted-foreground">Ten agent nie ma włączonych narzędzi.</p>
        )}
        {names.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {names.map((n) => (
              <li
                key={n.key}
                className="rounded-full border border-primary/30 px-2.5 py-1 text-[11px] text-foreground"
              >
                {n.label}
                {usage7d && (usage7d[n.key] ?? 0) > 0 && (
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    ×{usage7d[n.key]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={manage}
          className="font-display border-b border-primary/60 pb-0.5 text-[10px] uppercase tracking-[0.25em] text-primary hover:text-foreground"
        >
          Zarządzaj narzędziami →
        </button>
      </div>
    </HudPanel>
  );
}
