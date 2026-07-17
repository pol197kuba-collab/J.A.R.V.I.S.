import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useAudioSettings } from "@/lib/audio/useAudioSettings";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { CommandDirectory } from "@/components/jarvis/CommandDirectory";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteGeminiKey,
  deleteGroqKey,
  getGeminiKeyStatus,
  getGroqKeyStatus,
  getUserSettings,
  listAgentTools,
  saveGeminiKey,
  saveGroqKey,
  setAgentToolEnabled,
  updateUserSettings,
  type AgentToolSummary,
  type UserSettings,
} from "@/lib/agents/runtime.functions";
import { setServerRuntimePreference } from "@/lib/ai/jarvisBrain";
import { GEMINI_MODELS } from "@/lib/agents/models";

const GEMINI_LS_KEY = "jarvis_gemini_api_key";
// Groq has no browser-side consumer (unlike Gemini) — this local copy exists
// purely so the input field doesn't look empty/"lost" every time Settings
// reloads, even though the real, functional copy already lives server-side.
const GROQ_LS_KEY = "jarvis_groq_api_key";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "JARVIS // Settings" },
      { name: "description", content: "Configure the JARVIS personal AI assistant." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { settings, set } = useAudioSettings();
  const [apiKey, setApiKey] = useState("");
  const [linked, setLinked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const fetchKeyStatus = useServerFn(getGeminiKeyStatus);
  const persistKey = useServerFn(saveGeminiKey);
  const clearKey = useServerFn(deleteGeminiKey);
  const fetchSettings = useServerFn(getUserSettings);
  const persistSettings = useServerFn(updateUserSettings);

  const [serverStatus, setServerStatus] = useState<"loading" | "linked" | "empty" | "error">(
    "loading",
  );
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<UserSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Groq — optional, free-tier fallback (UI-action classifier + failover
  // only). No client-side/localStorage copy: unlike Gemini, nothing in the
  // browser ever calls Groq directly, so the server key is the only copy.
  const fetchGroqStatus = useServerFn(getGroqKeyStatus);
  const persistGroqKey = useServerFn(saveGroqKey);
  const clearGroqKey = useServerFn(deleteGroqKey);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqStatus, setGroqStatus] = useState<"loading" | "linked" | "empty" | "error">("loading");
  const [groqPreview, setGroqPreview] = useState<string | null>(null);
  const [groqBusy, setGroqBusy] = useState(false);
  const [groqErrorMsg, setGroqErrorMsg] = useState<string | null>(null);

  const fetchAgentTools = useServerFn(listAgentTools);
  const persistAgentTool = useServerFn(setAgentToolEnabled);
  const [tools, setTools] = useState<AgentToolSummary[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [pendingToolId, setPendingToolId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(GEMINI_LS_KEY) ?? "";
      setApiKey(v);
      setLinked(!!v);
    } catch {
      /* ignore */
    }
    try {
      setGroqApiKey(window.localStorage.getItem(GROQ_LS_KEY) ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  const refreshServerState = useCallback(async () => {
    try {
      const [status, s] = await Promise.all([fetchKeyStatus(), fetchSettings()]);
      setServerStatus(status.linked ? "linked" : "empty");
      setServerPreview(status.preview);
      setPrefs(s);
      setServerRuntimePreference({
        routing: s.chatRouting,
        keyLinked: status.linked,
      });
    } catch (err) {
      console.warn("[settings] refresh failed", err);
      setServerStatus("error");
    }
  }, [fetchKeyStatus, fetchSettings]);

  useEffect(() => {
    void refreshServerState();
  }, [refreshServerState]);

  const refreshGroqState = useCallback(async () => {
    try {
      const status = await fetchGroqStatus();
      setGroqStatus(status.linked ? "linked" : "empty");
      setGroqPreview(status.preview);
    } catch (err) {
      console.warn("[settings] groq refresh failed", err);
      setGroqStatus("error");
    }
  }, [fetchGroqStatus]);

  useEffect(() => {
    void refreshGroqState();
  }, [refreshGroqState]);

  const handleSaveGroqKey = async () => {
    const trimmed = groqApiKey.trim();
    setGroqBusy(true);
    setGroqErrorMsg(null);
    try {
      if (trimmed) {
        await persistGroqKey({ data: { key: trimmed } });
      } else {
        await clearGroqKey();
      }
      try {
        if (trimmed) {
          window.localStorage.setItem(GROQ_LS_KEY, trimmed);
        } else {
          window.localStorage.removeItem(GROQ_LS_KEY);
        }
      } catch {
        /* ignore — cosmetic only, server sync above is what actually matters */
      }
      audio.playClick();
      await refreshGroqState();
    } catch (err) {
      setGroqErrorMsg(err instanceof Error ? err.message : "Server sync failed");
    } finally {
      setGroqBusy(false);
    }
  };

  const refreshTools = useCallback(async () => {
    try {
      const list = await fetchAgentTools({ data: { agentSlug: "orchestrator" } });
      setTools(list);
      setToolsError(null);
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : "Failed to load tools");
    }
  }, [fetchAgentTools]);

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

  const handleToggleTool = async (tool: AgentToolSummary) => {
    const nextEnabled = !tool.enabledForAgent;
    setPendingToolId(tool.id);
    // Optimistic update — revert on failure.
    setTools(
      (prev) =>
        prev?.map((t) => (t.id === tool.id ? { ...t, enabledForAgent: nextEnabled } : t)) ?? prev,
    );
    try {
      await persistAgentTool({
        data: { agentSlug: "orchestrator", toolId: tool.id, enabled: nextEnabled },
      });
      audio.playClick();
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : "Failed to update tool");
      setTools(
        (prev) =>
          prev?.map((t) => (t.id === tool.id ? { ...t, enabledForAgent: !nextEnabled } : t)) ??
          prev,
      );
    } finally {
      setPendingToolId(null);
    }
  };

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    try {
      if (trimmed) {
        window.localStorage.setItem(GEMINI_LS_KEY, trimmed);
        setLinked(true);
        speak("Rdzeń AI zaktualizowany, Panie Sławiński.");
      } else {
        window.localStorage.removeItem(GEMINI_LS_KEY);
        setLinked(false);
        speak("Klucz rdzenia AI usunięty.");
      }
      audio.playClick();
      setSavedAt(Date.now());
    } catch {
      /* ignore */
    }
  };

  const handleServerSaveKey = async () => {
    const trimmed = apiKey.trim();
    setBusy(true);
    setErrorMsg(null);
    try {
      if (trimmed) {
        await persistKey({ data: { key: trimmed } });
      } else {
        await clearKey();
      }
      audio.playClick();
      await refreshServerState();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Server sync failed");
    } finally {
      setBusy(false);
    }
  };

  const updatePref = async (patch: Partial<UserSettings>) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const next = await persistSettings({ data: patch });
      setPrefs(next);
      setServerRuntimePreference({
        routing: next.chatRouting,
        keyLinked: serverStatus === "linked",
      });
      // Notify live consumers (VoiceCommandContext reads wake_word_enabled)
      // so the change applies without a page reload.
      window.dispatchEvent(new CustomEvent("jarvis:prefs-updated"));
      audio.playClick();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
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
              SAVE LOCAL (BROWSER)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleServerSaveKey}
              className="font-display border border-primary/60 bg-primary/20 px-4 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/30 disabled:opacity-50"
            >
              SYNC TO AGENT RUNTIME
            </button>
          </div>
          <div className="grid gap-2 border-t border-primary/20 pt-2 sm:grid-cols-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                BROWSER
              </span>
              <span
                className="font-display text-[10px] uppercase tracking-widest"
                style={{ color: linked ? "var(--success)" : "var(--muted-foreground)" }}
              >
                {linked ? "● LINKED" : "○ EMPTY"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                AGENT RUNTIME
              </span>
              <span
                className="font-display text-[10px] uppercase tracking-widest"
                style={{
                  color:
                    serverStatus === "linked"
                      ? "var(--success)"
                      : serverStatus === "error"
                        ? "var(--destructive)"
                        : "var(--muted-foreground)",
                }}
              >
                {serverStatus === "linked"
                  ? `● LINKED ${serverPreview ?? ""}`
                  : serverStatus === "error"
                    ? "✕ UNREACHABLE"
                    : serverStatus === "loading"
                      ? "… CHECKING"
                      : "○ NOT SYNCED"}
              </span>
            </div>
          </div>
          {savedAt && (
            <p className="font-mono text-[10px] text-primary/70">
              ✓ Configuration committed @ {new Date(savedAt).toLocaleTimeString()}
            </p>
          )}
          {errorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {errorMsg}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ „Save local" trzyma klucz tylko w tej przeglądarce. „Sync to Agent Runtime" wysyła go
            zaszyfrowanym połączeniem na serwer, gdzie używa go Orchestrator — nadal Twój klucz,
            Twój ruch, darmowy tier Gemini. Puste pole + zapis = usunięcie klucza.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={1} title="GROQ // FREE FALLBACK ENGINE" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            GROQ API KEY // OPCJONALNY, DARMOWY TIER
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="Wklej Groq API Key..."
              className="font-mono flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={groqBusy}
              onClick={handleSaveGroqKey}
              className="font-display border border-primary/60 bg-primary/20 px-4 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/30 disabled:opacity-50"
            >
              SYNC TO AGENT RUNTIME
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-primary/20 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              AGENT RUNTIME
            </span>
            <span
              className="font-display text-[10px] uppercase tracking-widest"
              style={{
                color:
                  groqStatus === "linked"
                    ? "var(--success)"
                    : groqStatus === "error"
                      ? "var(--destructive)"
                      : "var(--muted-foreground)",
              }}
            >
              {groqStatus === "linked"
                ? `● LINKED ${groqPreview ?? ""}`
                : groqStatus === "error"
                  ? "✕ UNREACHABLE"
                  : groqStatus === "loading"
                    ? "… CHECKING"
                    : "○ NOT SYNCED"}
            </span>
          </div>
          {groqErrorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {groqErrorMsg}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Darmowy klucz z console.groq.com, bez karty płatniczej. Orchestrator używa go tylko do
            dwóch rzeczy: (1) klasyfikacji „czy to komenda UI" zamiast płatnego wywołania Gemini
            przy każdej wiadomości, (2) awaryjnego fallbacku, gdy Gemini padnie (rate limit / błąd).
            Główna rozmowa i narzędzia (web_search, pamięć) nadal idą przez Gemini. Puste pole +
            zapis = usunięcie klucza.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={2} title="AGENT RUNTIME // CHAT ROUTING" className="p-5">
        <div className="mt-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">Route chat through Agent Runtime</p>
              <p className="text-xs text-muted-foreground">
                Wysyła wiadomości przez serwerowego Orchestratora (log w agent_runs, historia w DB).
                Wymaga „Sync to Agent Runtime" wyżej.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !prefs || serverStatus !== "linked"}
              onClick={() =>
                updatePref({
                  chatRouting: prefs?.chatRouting === "server" ? "client" : "server",
                })
              }
              className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
              style={{
                color:
                  prefs?.chatRouting === "server" ? "var(--success)" : "var(--muted-foreground)",
              }}
            >
              {prefs?.chatRouting === "server" ? "● SERVER" : "○ BROWSER"}
            </button>
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-primary/20 pt-3">
            <div>
              <p className="text-sm text-foreground">Default model</p>
              <p className="text-xs text-muted-foreground">
                Model używany przez Orchestratora dla każdego runu.
              </p>
            </div>
            <select
              disabled={busy || !prefs}
              value={prefs?.defaultModel ?? ""}
              onChange={(e) => updatePref({ defaultModel: e.target.value })}
              className="font-mono min-w-[220px] border border-primary/60 bg-black/60 px-3 py-1.5 text-xs text-primary outline-none focus:border-primary disabled:opacity-40"
            >
              {prefs && !GEMINI_MODELS.some((m) => m.id === prefs.defaultModel) && (
                <option value={prefs.defaultModel}>{prefs.defaultModel} (custom)</option>
              )}
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-primary/20 pt-3">
            <div>
              <p className="text-sm text-foreground">Voice reply language</p>
              <p className="text-xs text-muted-foreground">
                Auto = model dopasowuje język do wiadomości.
              </p>
            </div>
            <div className="flex gap-2">
              {(["auto", "en", "pl"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  disabled={busy || !prefs}
                  onClick={() => updatePref({ voiceLanguage: lang })}
                  className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
                  style={{
                    color:
                      prefs?.voiceLanguage === lang ? "var(--primary)" : "var(--muted-foreground)",
                  }}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-primary/20 pt-3">
            <div>
              <p className="text-sm text-foreground">Wake word „J.A.R.V.I.S."</p>
              <p className="text-xs text-muted-foreground">
                ON: „Jarvis" wymagany tylko do ROZPOCZĘCIA rozmowy — po każdej odpowiedzi masz 20 s
                na kontynuację bez wake worda. OFF: słucha zawsze, „Jarvis" nigdy nie jest wymagany.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !prefs}
              onClick={() => updatePref({ wakeWordEnabled: !(prefs?.wakeWordEnabled ?? true) })}
              className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
              style={{
                color: prefs?.wakeWordEnabled ? "var(--success)" : "var(--muted-foreground)",
              }}
            >
              {prefs?.wakeWordEnabled ? "● ON" : "○ OFF"}
            </button>
          </div>
        </div>
      </HudPanel>
      <HudPanel index={2} title="ORCHESTRATOR // TOOLS" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            NARZĘDZIA DOSTĘPNE DLA AGENTA „ORCHESTRATOR"
          </p>
          {toolsError && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {toolsError}
            </p>
          )}
          {tools === null && !toolsError && (
            <p className="font-mono text-[10px] text-muted-foreground/70">Ładowanie…</p>
          )}
          {tools?.length === 0 && (
            <p className="font-mono text-[10px] text-muted-foreground/70">
              Brak agenta „orchestrator" lub brak zarejestrowanych narzędzi.
            </p>
          )}
          {tools?.map((tool, i) => (
            <div
              key={tool.id}
              className={`flex items-start justify-between gap-4 ${i > 0 ? "border-t border-primary/20 pt-3" : ""}`}
            >
              <div>
                <p className="text-sm text-foreground">
                  {tool.name}
                  {!tool.globallyEnabled && (
                    <span
                      className="ml-2 font-mono text-[10px] uppercase tracking-widest"
                      style={{ color: "var(--destructive)" }}
                    >
                      GLOBALLY DISABLED
                    </span>
                  )}
                </p>
                {tool.description && (
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                )}
              </div>
              <button
                type="button"
                disabled={pendingToolId === tool.id || !tool.globallyEnabled}
                onClick={() => handleToggleTool(tool)}
                className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
                style={{
                  color: tool.enabledForAgent ? "var(--success)" : "var(--muted-foreground)",
                }}
              >
                {tool.enabledForAgent ? "● ON" : "○ OFF"}
              </button>
            </div>
          ))}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Wyłączenie tu nie usuwa narzędzia — Orchestrator po prostu nie zaproponuje go modelowi
            przy kolejnym uruchomieniu (agent_runs/tool_calls nie będzie go zawierać).
          </p>
        </div>
      </HudPanel>
      <CommandDirectory index={2} />
      <HudPanel index={3} title="AUDIO // SUBSYSTEM" className="p-5">
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
              <p className="text-xs text-muted-foreground">
                Low-frequency drone during active session
              </p>
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
      <HudPanel index={4} title="PLANNED // ROADMAP" className="p-5">
        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p>
            Poniższe moduły są na roadmapie — pojawią się jako realne opcje wraz z kolejnymi
            agentami:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Security / biometric auth</li>
            <li>Discord & Calendar integrations</li>
            <li>Lab telemetry uplink</li>
            <li>Multi-agent orchestration (Architect, Developer, ...)</li>
          </ul>
        </div>
      </HudPanel>
    </div>
  );
}
