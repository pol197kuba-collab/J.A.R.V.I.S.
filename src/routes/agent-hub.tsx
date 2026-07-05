import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAgents } from "@/lib/agents/runtime.functions";

export const Route = createFileRoute("/agent-hub")({
  head: () => ({
    meta: [
      { title: "JARVIS // Agent Hub" },
      { name: "description", content: "Manage JARVIS sub-agents and their assigned subsystems." },
    ],
  }),
  component: AgentHub,
});

const statusColor: Record<string, string> = {
  active: "var(--success)",
  running: "var(--success)",
  idle: "var(--muted-foreground)",
  error: "var(--destructive)",
};

function AgentHub() {
  const fetchAgents = useServerFn(listAgents);
  const { data: agents = [], isLoading, error } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 5000,
  });

  const onlineCount = agents.filter((a) => a.isEnabled).length;

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="SUBSYSTEM // AGENT HUB" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">AGENT HUB</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {agents.length} REGISTERED NODES // {onlineCount} ENABLED
        </p>
      </HudPanel>
      {isLoading && (
        <HudPanel index={1} className="p-5">
          <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            ▸ QUERYING AGENT REGISTRY…
          </p>
        </HudPanel>
      )}
      {error && (
        <HudPanel index={1} className="p-5">
          <p className="font-display text-xs uppercase tracking-widest" style={{ color: "var(--destructive)" }}>
            ✕ REGISTRY UNREACHABLE — {error instanceof Error ? error.message : String(error)}
          </p>
        </HudPanel>
      )}
      {!isLoading && !error && agents.length === 0 && (
        <HudPanel index={1} className="p-5">
          <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            ▸ NO AGENTS PROVISIONED. RELOG TO SEED THE ORCHESTRATOR.
          </p>
        </HudPanel>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a, i) => (
          <HudPanel key={a.id} index={i + 1} className="p-5 transition hover:shadow-[var(--glow-primary)]">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center border border-primary/50 bg-primary/10 text-primary">
                  <Bot strokeWidth={1.5} className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display text-base font-semibold tracking-widest">{a.name}</p>
                  <p className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    {a.role ?? a.slug}
                  </p>
                </div>
              </div>
              <span
                className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-widest"
                style={{ color: statusColor[a.status] ?? "var(--muted-foreground)" }}
              >
                <span
                  className="h-1.5 w-1.5 animate-blink rounded-full"
                  style={{ backgroundColor: statusColor[a.status] ?? "var(--muted-foreground)" }}
                />
                {a.isEnabled ? a.status : "disabled"}
              </span>
            </div>
            {a.description && (
              <p className="mt-3 text-xs text-muted-foreground/90">{a.description}</p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-primary/25 pt-3 text-xs text-muted-foreground">
              <div>
                <p className="font-display tracking-[0.2em]">ACTIVE RUNS</p>
                <p className="font-display text-lg font-semibold text-primary">{a.activeRuns}</p>
              </div>
              <div>
                <p className="font-display tracking-[0.2em]">MODEL</p>
                <p className="font-mono text-[11px] text-foreground">{a.model ?? "—"}</p>
              </div>
            </div>
            {a.lastRunAt && (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
                last run · {new Date(a.lastRunAt).toLocaleString()}
              </p>
            )}
          </HudPanel>
        ))}
      </div>
    </div>
  );
}