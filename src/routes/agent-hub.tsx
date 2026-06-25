import { createFileRoute } from "@tanstack/react-router";
import { agents } from "@/data/mock";
import { Bot } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";

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
  online: "var(--success)",
  alert: "var(--warning)",
  idle: "var(--muted-foreground)",
};

function AgentHub() {
  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="SUBSYSTEM // AGENT HUB" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">AGENT HUB</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {agents.length} REGISTERED NODES // {agents.filter((a) => a.status === "online").length} ONLINE
        </p>
      </HudPanel>
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
                    {a.role}
                  </p>
                </div>
              </div>
              <span
                className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-widest"
                style={{ color: statusColor[a.status] }}
              >
                <span
                  className="h-1.5 w-1.5 animate-blink rounded-full"
                  style={{ backgroundColor: statusColor[a.status] }}
                />
                {a.status}
              </span>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-primary/25 pt-3 text-xs text-muted-foreground">
              <span className="font-display tracking-[0.2em]">ACTIVE TASKS</span>
              <span className="font-display text-lg font-semibold text-primary">{a.tasks}</span>
            </div>
          </HudPanel>
        ))}
      </div>
    </div>
  );
}