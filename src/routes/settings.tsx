import { createFileRoute } from "@tanstack/react-router";
import { HudPanel } from "@/components/jarvis/HudPanel";

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
      <HudPanel index={0} title="CONFIGURATION // CORE" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SETTINGS</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          STARK SECURE PROFILE // TONY @ JARVIS.LOCAL
        </p>
      </HudPanel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g, i) => (
          <HudPanel key={g.label} index={i + 1} title={g.label.toUpperCase()} className="p-5">
            <div className="mt-4 space-y-3">
              {g.items.map((it) => (
                <div
                  key={it.name}
                  className="flex items-center justify-between border-b border-primary/20 pb-2 last:border-0"
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
          </HudPanel>
        ))}
      </div>
    </div>
  );
}