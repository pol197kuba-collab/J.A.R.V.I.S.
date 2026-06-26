import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useAudioSettings } from "@/lib/audio/useAudioSettings";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { CommandDirectory } from "@/components/jarvis/CommandDirectory";

const GEMINI_LS_KEY = "jarvis_gemini_api_key";

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
  const { settings, set } = useAudioSettings();
  const [apiKey, setApiKey] = useState("");
  const [linked, setLinked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(GEMINI_LS_KEY) ?? "";
      setApiKey(v);
      setLinked(!!v);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    try {
      if (trimmed) {
        window.localStorage.setItem(GEMINI_LS_KEY, trimmed);
        setLinked(true);
        speak("AI core updated, sir.");
      } else {
        window.localStorage.removeItem(GEMINI_LS_KEY);
        setLinked(false);
        speak("AI core key cleared.");
      }
      audio.playClick();
      setSavedAt(Date.now());
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="CONFIGURATION // CORE" className="p-5">
        <h1 className="font-display mt-2 text-3xl font-bold tracking-[0.18em]">SETTINGS</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          SECURE PROFILE // JACOB.SLAWINSKY @ JARVIS.LOCAL
        </p>
      </HudPanel>
      <HudPanel index={1} title="AI CORE CONFIGURATION" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            GOOGLE GEMINI API KEY // STORED LOCALLY ON DEVICE
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Wklej Google Gemini API Key..."
              className="font-mono flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleSaveKey}
              className="font-display border border-primary/60 bg-primary/10 px-4 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              SAVE &amp; CONNECT CORE
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-primary/20 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              STATUS
            </span>
            <span
              className="font-display text-[10px] uppercase tracking-widest"
              style={{ color: linked ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {linked ? "● AI CORE LINK ESTABLISHED" : "○ NO KEY // FALLBACK MODE"}
            </span>
          </div>
          {savedAt && (
            <p className="font-mono text-[10px] text-primary/70">
              ✓ Configuration committed @ {new Date(savedAt).toLocaleTimeString()}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Klucz jest przechowywany wyłącznie w pamięci tego urządzenia (localStorage). Puste pole + zapis = usunięcie klucza.
          </p>
        </div>
      </HudPanel>
      <CommandDirectory index={2} />
      <HudPanel index={2} title="AUDIO // SUBSYSTEM" className="p-5">
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                Master Volume
              </span>
              <span className="font-mono text-xs text-foreground">
                {Math.round(settings.master * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.master * 100)}
              onChange={(e) => set({ master: Number(e.target.value) / 100 })}
              className="mt-2 w-full accent-[color:var(--primary)]"
            />
          </div>
          <div className="flex items-center justify-between border-t border-primary/20 pt-3">
            <div>
              <p className="text-sm text-foreground">Ambient Reactor Hum</p>
              <p className="text-xs text-muted-foreground">Low-frequency drone during active session</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !settings.hum;
                set({ hum: next });
                if (next) audio.startHum();
              }}
              className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest"
              style={{ color: settings.hum ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {settings.hum ? "● On" : "○ Off"}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-primary/20 pt-3">
            <div>
              <p className="text-sm text-foreground">UI Sounds</p>
              <p className="text-xs text-muted-foreground">Clicks, beeps, access tones</p>
            </div>
            <button
              type="button"
              onClick={() => {
                set({ ui: !settings.ui });
                audio.playClick();
              }}
              className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest"
              style={{ color: settings.ui ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {settings.ui ? "● On" : "○ Off"}
            </button>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Microphone access is requested on first voice activation in the dashboard.
          </p>
        </div>
      </HudPanel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g, i) => (
          <HudPanel key={g.label} index={i + 3} title={g.label.toUpperCase()} className="p-5">
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