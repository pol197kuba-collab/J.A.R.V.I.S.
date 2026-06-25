import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "JARVIS // Settings" },
      { name: "description", content: "Configure the JARVIS personal AI assistant." },
    ],
  }),
  component: Settings,
});

const groups = [
  {
    label: "Voice Interface",
    items: [
      { name: "Wake word", value: "Hey JARVIS", on: true },
      { name: "Response voice", value: "British male, calm", on: true },
      { name: "Continuous listening", value: "Disabled", on: false },
    ],
  },
  {
    label: "Security",
    items: [
      { name: "Biometric authentication", value: "Required", on: true },
      { name: "Encrypted comms", value: "AES-256", on: true },
      { name: "Perimeter scan interval", value: "30 seconds", on: true },
    ],
  },
  {
    label: "Integrations",
    items: [
      { name: "Discord", value: "Connected", on: true },
      { name: "Calendar", value: "Connected", on: true },
      { name: "Lab telemetry", value: "Offline", on: false },
    ],
  },
];

function Settings() {
  return (
    <div className="space-y-6 p-6">
      <header>
        <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary">
          Configuration // Core
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold tracking-[0.15em]">SETTINGS</h1>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.label} className="rounded-lg border border-border/60 bg-card/50 p-5 backdrop-blur">
            <p className="font-display text-[10px] uppercase tracking-[0.3em] text-primary">
              {g.label}
            </p>
            <div className="mt-4 space-y-3">
              {g.items.map((it) => (
                <div
                  key={it.name}
                  className="flex items-center justify-between border-b border-border/40 pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm text-foreground">{it.name}</p>
                    <p className="text-xs text-muted-foreground">{it.value}</p>
                  </div>
                  <span
                    className="font-display text-[10px] uppercase tracking-widest"
                    style={{ color: it.on ? "var(--success)" : "var(--muted-foreground)" }}
                  >
                    {it.on ? "● On" : "○ Off"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}