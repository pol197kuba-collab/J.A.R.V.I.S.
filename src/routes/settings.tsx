import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useAudioSettings } from "@/lib/audio/useAudioSettings";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteGeminiKey,
  deleteGithubToken,
  deleteGoogleCseCredentials,
  deleteAnthropicKey,
  deleteGroqKey,
  getGeminiKeyStatus,
  getGithubTokenStatus,
  getGoogleCseStatus,
  getAnthropicKeyStatus,
  getGroqKeyStatus,
  getUserSettings,
  listAgentTools,
  saveGeminiKey,
  saveGithubToken,
  saveGoogleCseCredentials,
  saveAnthropicKey,
  saveGroqKey,
  applyRecommendedAgentModels,
  setAgentToolEnabled,
  updateUserSettings,
  type AgentToolSummary,
  type UserSettings,
} from "@/lib/agents/runtime.functions";
import { setServerRuntimePreference } from "@/lib/ai/jarvisBrain";
import { useModelCatalog, MODEL_CATALOG_QUERY_KEY } from "@/lib/agents/useModelCatalog";
import { invalidateModelCatalog } from "@/lib/agents/models.functions";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

const GEMINI_LS_KEY = "jarvis_gemini_api_key";
// Groq has no browser-side consumer (unlike Gemini) — this local copy exists
// purely so the input field doesn't look empty/"lost" every time Settings
// reloads, even though the real, functional copy already lives server-side.
const GROQ_LS_KEY = "jarvis_groq_api_key";
// Same reasoning as GROQ_LS_KEY — no browser-side consumer, local copy only
// so the field doesn't read as empty after a reload.
const ANTHROPIC_LS_KEY = "jarvis_anthropic_api_key";

const CATALOG_STATUS_LABEL: Record<string, string> = {
  live: "z API",
  fallback: "zapasowa (API nie odpowiedziało)",
  no_key: "zapasowa (brak klucza)",
  loading: "ładowanie…",
};

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
  const { go } = useHudNavigate();
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

  // Anthropic — optional, unlocks Claude as the primary reasoning engine for
  // any agent whose model is "anthropic:"-prefixed. Server-side only, like
  // Groq: no browser code ever calls Anthropic directly.
  // Lista modeli pochodzi z API dostawców, nie ze słownika w repo —
  // statyczne listy zostają tylko jako zapas (patrz useModelCatalog).
  const qc = useQueryClient();
  const catalog = useModelCatalog();
  const dropModelCatalogCache = useServerFn(invalidateModelCatalog);
  const fetchAnthropicStatus = useServerFn(getAnthropicKeyStatus);
  const persistAnthropicKey = useServerFn(saveAnthropicKey);
  const clearAnthropicKey = useServerFn(deleteAnthropicKey);
  const applyRecommendedModels = useServerFn(applyRecommendedAgentModels);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicStatus, setAnthropicStatus] = useState<"loading" | "linked" | "empty" | "error">(
    "loading",
  );
  const [anthropicPreview, setAnthropicPreview] = useState<string | null>(null);
  const [anthropicBusy, setAnthropicBusy] = useState(false);
  const [anthropicErrorMsg, setAnthropicErrorMsg] = useState<string | null>(null);
  const [tieringMsg, setTieringMsg] = useState<string | null>(null);
  const [tieringBusy, setTieringBusy] = useState(false);

  // Google Custom Search — optional, self-serve upgrade for real-photo
  // lookup in generated documents. No client-side consumer, so (like Groq)
  // the server copy is the only one that matters; no localStorage mirror.
  const fetchCseStatus = useServerFn(getGoogleCseStatus);
  const persistCse = useServerFn(saveGoogleCseCredentials);
  const clearCse = useServerFn(deleteGoogleCseCredentials);
  const [cseApiKey, setCseApiKey] = useState("");
  const [cseCx, setCseCx] = useState("");
  const [cseStatus, setCseStatus] = useState<"loading" | "linked" | "empty" | "error">("loading");
  const [csePreview, setCsePreview] = useState<string | null>(null);
  const [cseBusy, setCseBusy] = useState(false);
  const [cseErrorMsg, setCseErrorMsg] = useState<string | null>(null);

  // GitHub Personal Access Token — Dev Wing / D.R.O.I.D. only, server-side.
  // No browser consumer at all (unlike Gemini), so like Groq/CSE there's no
  // localStorage mirror — the server copy is the only one that matters.
  const fetchGithubStatus = useServerFn(getGithubTokenStatus);
  const persistGithubToken = useServerFn(saveGithubToken);
  const clearGithubToken = useServerFn(deleteGithubToken);
  const [githubToken, setGithubToken] = useState("");
  const [githubStatus, setGithubStatus] = useState<"loading" | "linked" | "empty" | "error">(
    "loading",
  );
  const [githubPreview, setGithubPreview] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubErrorMsg, setGithubErrorMsg] = useState<string | null>(null);

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
      setAnthropicApiKey(window.localStorage.getItem(ANTHROPIC_LS_KEY) ?? "");
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

  const refreshAnthropicState = useCallback(async () => {
    try {
      const status = await fetchAnthropicStatus();
      setAnthropicStatus(status.linked ? "linked" : "empty");
      setAnthropicPreview(status.preview);
    } catch (err) {
      console.warn("[settings] anthropic refresh failed", err);
      setAnthropicStatus("error");
    }
  }, [fetchAnthropicStatus]);

  useEffect(() => {
    void refreshAnthropicState();
  }, [refreshAnthropicState]);

  const refreshCseState = useCallback(async () => {
    try {
      const status = await fetchCseStatus();
      setCseStatus(status.linked ? "linked" : "empty");
      setCsePreview(status.preview);
      if (status.cx) setCseCx((prev) => prev || status.cx!);
    } catch (err) {
      console.warn("[settings] google cse refresh failed", err);
      setCseStatus("error");
    }
  }, [fetchCseStatus]);

  useEffect(() => {
    void refreshCseState();
  }, [refreshCseState]);

  const refreshGithubState = useCallback(async () => {
    try {
      const status = await fetchGithubStatus();
      setGithubStatus(status.linked ? "linked" : "empty");
      setGithubPreview(status.preview);
    } catch (err) {
      console.warn("[settings] github token refresh failed", err);
      setGithubStatus("error");
    }
  }, [fetchGithubStatus]);

  useEffect(() => {
    void refreshGithubState();
  }, [refreshGithubState]);

  const handleSaveGithubToken = async () => {
    const trimmed = githubToken.trim();
    setGithubBusy(true);
    setGithubErrorMsg(null);
    try {
      if (trimmed) {
        await persistGithubToken({ data: { key: trimmed } });
      } else {
        await clearGithubToken();
      }
      audio.playClick();
      await refreshGithubState();
    } catch (err) {
      setGithubErrorMsg(err instanceof Error ? err.message : "Server sync failed");
    } finally {
      setGithubBusy(false);
    }
  };

  const handleSaveCse = async () => {
    const trimmedKey = cseApiKey.trim();
    const trimmedCx = cseCx.trim();
    setCseBusy(true);
    setCseErrorMsg(null);
    try {
      if (trimmedKey && trimmedCx) {
        await persistCse({ data: { key: trimmedKey, cx: trimmedCx } });
      } else if (!trimmedKey && !trimmedCx) {
        await clearCse();
      } else {
        setCseErrorMsg("Podaj oba pola (API key i Search Engine ID) albo wyczyść oba.");
        return;
      }
      audio.playClick();
      await refreshCseState();
    } catch (err) {
      setCseErrorMsg(err instanceof Error ? err.message : "Server sync failed");
    } finally {
      setCseBusy(false);
    }
  };

  // Zmiana klucza zmienia to, co API dostawcy w ogóle wylistuje, więc
  // cache katalogu modeli (serwerowy i klienta) musi pójść razem z nią.
  const refreshModelCatalog = async () => {
    try {
      await dropModelCatalogCache();
      await qc.invalidateQueries({ queryKey: MODEL_CATALOG_QUERY_KEY });
    } catch (err) {
      console.warn("[settings] model catalog refresh failed", err);
    }
  };

  const handleSaveAnthropicKey = async () => {
    const trimmed = anthropicApiKey.trim();
    setAnthropicBusy(true);
    setAnthropicErrorMsg(null);
    try {
      if (trimmed) {
        await persistAnthropicKey({ data: { key: trimmed } });
      } else {
        await clearAnthropicKey();
      }
      try {
        if (trimmed) {
          window.localStorage.setItem(ANTHROPIC_LS_KEY, trimmed);
        } else {
          window.localStorage.removeItem(ANTHROPIC_LS_KEY);
        }
      } catch {
        /* ignore — cosmetic only, server sync above is what actually matters */
      }
      audio.playClick();
      await refreshAnthropicState();
      await refreshModelCatalog();
    } catch (err) {
      setAnthropicErrorMsg(err instanceof Error ? err.message : "Server sync failed");
    } finally {
      setAnthropicBusy(false);
    }
  };

  const handleApplyRecommendedModels = async () => {
    setTieringBusy(true);
    setTieringMsg(null);
    try {
      const result = await applyRecommendedModels();
      audio.playClick();
      setTieringMsg(
        result.changed === 0
          ? "Wszyscy agenci już mają rekomendowane modele."
          : `Zmieniono ${result.changed}: ${result.changes
              .map((c) => `${c.name} → ${c.to.replace("anthropic:", "")}`)
              .join(", ")}`,
      );
    } catch (err) {
      setTieringMsg(err instanceof Error ? err.message : "Nie udało się zastosować.");
    } finally {
      setTieringBusy(false);
    }
  };

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
      const list = await fetchAgentTools({ data: { agentSlug: AGENT_SLUGS.JARVIS } });
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
        data: { agentSlug: AGENT_SLUGS.JARVIS, toolId: tool.id, enabled: nextEnabled },
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
      await refreshModelCatalog();
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
            zaszyfrowanym połączeniem na serwer, gdzie używa go J.A.R.V.I.S. — nadal Twój klucz,
            Twój ruch, darmowy tier Gemini. Puste pole + zapis = usunięcie klucza.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={1} title="ANTHROPIC // CLAUDE REASONING CORE" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            ANTHROPIC API KEY // OPCJONALNY, PŁATNY
          </p>
          <div className="flex flex-col gap-2 @[520px]:flex-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              placeholder="Wklej Anthropic API Key..."
              className="font-mono min-w-0 flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={anthropicBusy}
              onClick={handleSaveAnthropicKey}
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
                  anthropicStatus === "linked"
                    ? "var(--success)"
                    : anthropicStatus === "error"
                      ? "var(--destructive)"
                      : "var(--muted-foreground)",
              }}
            >
              {anthropicStatus === "linked"
                ? `● LINKED ${anthropicPreview ?? ""}`
                : anthropicStatus === "error"
                  ? "✕ UNREACHABLE"
                  : anthropicStatus === "loading"
                    ? "… CHECKING"
                    : "○ NOT SYNCED"}
            </span>
          </div>
          {anthropicErrorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {anthropicErrorMsg}
            </p>
          )}
          <div className="flex flex-col gap-2 border-t border-primary/20 pt-3 @[520px]:flex-row @[520px]:items-center @[520px]:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Rekomendowany podział modeli</p>
              <p className="text-xs text-muted-foreground">
                Agenci rozumujący (J.A.R.V.I.S., Insight, Metric) → Opus 5; wykonawczy (Forge,
                Herald, Shield) → Sonnet 5. Resztę zostawia bez zmian.
              </p>
            </div>
            <button
              type="button"
              disabled={tieringBusy || anthropicStatus !== "linked"}
              onClick={handleApplyRecommendedModels}
              className="font-display shrink-0 border border-primary/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              {tieringBusy ? "…" : "ZASTOSUJ"}
            </button>
          </div>
          {tieringMsg && (
            <p className="font-mono text-[10px] break-words text-primary/80">{tieringMsg}</p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Klucz z console.anthropic.com — płatny, rozliczany za tokeny (Opus 5: $5 za 1M wejścia
            / $25 za 1M wyjścia, Sonnet 5: $2 / $10). Używany tylko dla agentów, którym ustawisz
            model „Claude…" w Centrum Agentów. Gemini pozostaje wymagany — web_search i pamięć
            semantyczna działają na jego API niezależnie od tego, kto prowadzi rozmowę. Bez tego
            klucza agent ustawiony na Claude degraduje się do Gemini z ostrzeżeniem w System Logs.
            Puste pole + zapis = usunięcie klucza.
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
            ℹ Darmowy klucz z console.groq.com, bez karty płatniczej. J.A.R.V.I.S. używa go tylko do
            dwóch rzeczy: (1) klasyfikacji „czy to komenda UI" zamiast płatnego wywołania Gemini
            przy każdej wiadomości, (2) awaryjnego fallbacku, gdy Gemini padnie (rate limit / błąd).
            Główna rozmowa i narzędzia (web_search, pamięć) nadal idą przez Gemini. Puste pole +
            zapis = usunięcie klucza.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={2} title="GOOGLE CUSTOM SEARCH // REAL PHOTO LOOKUP" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            OPCJONALNY UPGRADE — DOKŁADNIEJSZE PRAWDZIWE ZDJĘCIA W DOKUMENTACH
          </p>
          <div className="flex flex-col gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={cseApiKey}
              onChange={(e) => setCseApiKey(e.target.value)}
              placeholder="Wklej Google Custom Search API Key..."
              className="font-mono flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={cseCx}
              onChange={(e) => setCseCx(e.target.value)}
              placeholder="Wklej Search Engine ID (cx)..."
              className="font-mono flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={cseBusy}
              onClick={handleSaveCse}
              className="font-display self-start border border-primary/60 bg-primary/20 px-4 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/30 disabled:opacity-50"
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
                  cseStatus === "linked"
                    ? "var(--success)"
                    : cseStatus === "error"
                      ? "var(--destructive)"
                      : "var(--muted-foreground)",
              }}
            >
              {cseStatus === "linked"
                ? `● LINKED ${csePreview ?? ""}`
                : cseStatus === "error"
                  ? "✕ UNREACHABLE"
                  : cseStatus === "loading"
                    ? "… CHECKING"
                    : "○ NOT SYNCED"}
            </span>
          </div>
          {cseErrorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {cseErrorMsg}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Bez tego F.O.R.G.E. i tak szuka prawdziwych zdjęć za darmo (Wikipedia, wyszukiwanie po
            całym internecie, Openverse) zanim spadnie na grafikę AI — to pole tylko poprawia
            trafność. Załóż darmowy klucz na console.cloud.google.com (Custom Search JSON API, 100
            zapytań/dzień gratis) i własną wyszukiwarkę na programmablesearchengine.google.com, żeby
            dostać jej "cx" ID. Puste oba pola + zapis = usunięcie danych.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={2} title="D.R.O.I.D. // GITHUB ACCESS" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            GITHUB PERSONAL ACCESS TOKEN // WYMAGANE DLA ZADAŃ PROGRAMISTYCZNYCH
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="Wklej GitHub Personal Access Token (ghp_... lub github_pat_...)..."
              className="font-mono flex-1 border border-primary/60 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={githubBusy}
              onClick={handleSaveGithubToken}
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
                  githubStatus === "linked"
                    ? "var(--success)"
                    : githubStatus === "error"
                      ? "var(--destructive)"
                      : "var(--muted-foreground)",
              }}
            >
              {githubStatus === "linked"
                ? `● LINKED ${githubPreview ?? ""}`
                : githubStatus === "error"
                  ? "✕ UNREACHABLE"
                  : githubStatus === "loading"
                    ? "… CHECKING"
                    : "○ NOT SYNCED"}
            </span>
          </div>
          {githubErrorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {githubErrorMsg}
            </p>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            ℹ Potrzebny, żeby D.R.O.I.D. mógł zakładać issue z zadaniami programistycznymi w
            repozytoriach podpiętych do Twoich projektów. Załóż fine-grained token na
            github.com/settings/personal-access-tokens z uprawnieniem „Issues: Read and write" (i
            „Contents: Read" jeśli chcesz też podgląd repo) ograniczonym tylko do konkretnych
            repozytoriów. Puste pole + zapis = usunięcie tokena.
          </p>
        </div>
      </HudPanel>
      <HudPanel index={2} title="AGENT RUNTIME // CHAT ROUTING" className="p-5">
        <div className="mt-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">Route chat through Agent Runtime</p>
              <p className="text-xs text-muted-foreground">
                Wysyła wiadomości przez serwerowego J.A.R.V.I.S.-a (log w agent_runs, historia w
                DB). Wymaga „Sync to Agent Runtime" wyżej.
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
                Model używany przez J.A.R.V.I.S.-a dla każdego runu.
              </p>
              {/* Skąd pochodzi lista — bez tego „widzę stare modele" wygląda
                  identycznie jak „nie ma klucza". */}
              <p className="font-mono mt-1 text-[10px] text-muted-foreground/70">
                Lista: Gemini {CATALOG_STATUS_LABEL[catalog.geminiStatus]} · Claude{" "}
                {CATALOG_STATUS_LABEL[catalog.anthropicStatus]}
              </p>
              {catalog.errors.length > 0 && (
                <p
                  className="font-mono mt-1 break-words text-[10px]"
                  style={{ color: "var(--warning)" }}
                >
                  {catalog.errors.join(" · ")}
                </p>
              )}
            </div>
            <select
              disabled={busy || !prefs}
              value={prefs?.defaultModel ?? ""}
              onChange={(e) => updatePref({ defaultModel: e.target.value })}
              className="font-mono min-w-[220px] border border-primary/60 bg-black/60 px-3 py-1.5 text-xs text-primary outline-none focus:border-primary disabled:opacity-40"
            >
              {prefs && !catalog.models.some((m) => m.id === prefs.defaultModel) && (
                <option value={prefs.defaultModel}>{prefs.defaultModel} (spoza listy)</option>
              )}
              <optgroup label="Google Gemini">
                {catalog.gemini.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Anthropic Claude (wymaga klucza)">
                {catalog.anthropic.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.hint ? ` — ${m.hint}` : ""}
                  </option>
                ))}
              </optgroup>
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
      <HudPanel index={2} title="J.A.R.V.I.S. // TOOLS" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            NARZĘDZIA DOSTĘPNE DLA AGENTA „J.A.R.V.I.S."
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
              Brak agenta „jarvis" lub brak zarejestrowanych narzędzi.
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
            ℹ Wyłączenie tu nie usuwa narzędzia — J.A.R.V.I.S. po prostu nie zaproponuje go modelowi
            przy kolejnym uruchomieniu (agent_runs/tool_calls nie będzie go zawierać).
          </p>
        </div>
      </HudPanel>
      <HudPanel index={2} title="COMMAND DIRECTORY" tone="quiet" className="p-5">
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-muted-foreground">
            The full command directory and a live voice/text test playground now live in their own
            module.
          </p>
          <button
            type="button"
            onClick={() => {
              audio.playClick();
              go("/commands");
            }}
            className="font-display shrink-0 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-primary transition hover:border-primary hover:bg-primary/20"
          >
            Open Commands →
          </button>
        </div>
      </HudPanel>
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
