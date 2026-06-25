import { createFileRoute } from "@tanstack/react-router";
import { agents } from "@/data/mock";
import { Bot } from "lucide-react";

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
      <header>
        <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary">
          Subsystem // Agents
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold tracking-[0.15em]">AGENT HUB</h1>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div
            key={a.id}
            className="group rounded-lg border border-border/60 bg-card/50 p-5 backdrop-blur transition hover:border-primary/50"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
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
            <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Active tasks</span>
              <span className="font-display text-lg font-semibold text-primary">{a.tasks}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}