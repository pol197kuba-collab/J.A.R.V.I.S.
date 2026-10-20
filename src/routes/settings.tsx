import { PushTestButton } from "@/components/jarvis/orders/PushTestButton";
import { BriefDelivery } from "@/components/jarvis/brief/BriefDelivery";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { UiModeSettings } from "@/components/jarvis/UiModeSettings";
import { PushToggle } from "@/components/jarvis/orders/PushToggle";
import { BriefScheduleControls } from "@/components/jarvis/brief/BriefScheduleControls";
import { ApiKeysSection } from "@/components/jarvis/settings/ApiKeysSection";
import { useAudioSettings } from "@/lib/audio/useAudioSettings";
import { audio } from "@/lib/audio/AudioEngine";
import { useServerFn } from "@tanstack/react-start";
import {
  getUserSettings,
  listAgentTools,
  setAgentToolEnabled,
  updateUserSettings,
  type AgentToolSummary,
  type UserSettings,
} from "@/lib/agents/runtime.functions";
import { setServerRuntimePreference } from "@/lib/ai/jarvisBrain";
import { useModelCatalog } from "@/lib/agents/useModelCatalog";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { cn } from "@/lib/utils";

const CATALOG_STATUS_LABEL: Record<string, string> = {
  live: "z API",
  fallback: "zapasowa (API nie odpowiedziało)",
  no_key: "zapasowa (brak klucza)",
  loading: "ładowanie…",
};

const TABS = [
  { id: "keys", label: "Klucze API" },
  { id: "jarvis", label: "J.A.R.V.I.S." },
  { id: "notifications", label: "Powiadomienia" },
  { id: "look", label: "Wygląd i dźwięk" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_LS_KEY = "jarvis_settings_tab";

const toggleClass =
  "font-display shrink-0 border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40";

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
  const [tab, setTab] = useState<TabId>("keys");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_LS_KEY);
      if (TABS.some((t) => t.id === saved)) setTab(saved as TabId);
    } catch {
      /* ignore */
    }
  }, []);
  const pickTab = (id: TabId) => {
    audio.playClick();
    setTab(id);
    try {
      window.localStorage.setItem(TAB_LS_KEY, id);
    } catch {
      /* ignore */
    }
  };

  // Czy serwer ma klucz Gemini — od tego zależy, czy czat może iść przez serwer.
  // null = jeszcze nie wiadomo; wtedy nie ruszamy zapamiętanej preferencji.
  const [geminiLinked, setGeminiLinked] = useState<boolean | null>(null);
  const fetchSettings = useServerFn(getUserSettings);
  useEffect(() => {
    if (geminiLinked === null) return;
    fetchSettings()
      .then((s) => setServerRuntimePreference({ routing: s.chatRouting, keyLinked: geminiLinked }))
      .catch((err) => console.warn("[settings] runtime preference refresh failed", err));
  }, [fetchSettings, geminiLinked]);

  return (
    <div className="space-y-6 p-6">
      <HudPanel index={0} title="CONFIGURATION // CORE" className="p-5">
        <h1 className="font-display mt-2 text-2xl font-bold tracking-[0.18em]">USTAWIENIA</h1>
        <div
          role="tablist"
          aria-label="Sekcje ustawień"
          className="mt-4 flex flex-wrap gap-1 rounded-2xl border border-primary/30 bg-primary/[0.04] p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => pickTab(t.id)}
              className={cn(
                "font-display rounded-xl px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-primary/70 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </HudPanel>

      {/* Klucze ładujemy zawsze — sekcja J.A.R.V.I.S. potrzebuje wiedzieć,
          czy serwer ma klucz Gemini. */}
      <div hidden={tab !== "keys"}>
        <ApiKeysSection onGeminiLinked={setGeminiLinked} />
      </div>
      {tab === "jarvis" && <JarvisSection geminiLinked={geminiLinked === true} />}
      {tab === "notifications" && <NotificationsSection />}
      {tab === "look" && <LookSection />}
    </div>
  );
}

function JarvisSection({ geminiLinked }: { geminiLinked: boolean }) {
  const catalog = useModelCatalog();
  const fetchSettings = useServerFn(getUserSettings);
  const persistSettings = useServerFn(updateUserSettings);
  const [prefs, setPrefs] = useState<UserSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchAgentTools = useServerFn(listAgentTools);
  const persistAgentTool = useServerFn(setAgentToolEnabled);
  const [tools, setTools] = useState<AgentToolSummary[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [pendingToolId, setPendingToolId] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then(setPrefs)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Nie udało się wczytać."));
  }, [fetchSettings]);

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

  const updatePref = async (patch: Partial<UserSettings>) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const next = await persistSettings({ data: patch });
      setPrefs(next);
      setServerRuntimePreference({ routing: next.chatRouting, keyLinked: geminiLinked });
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

  return (
    <div className="space-y-6">
      <HudPanel index={1} title="ROZMOWA" className="p-5">
        <div className="mt-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Czat przez serwer</p>
              <p className="text-xs text-muted-foreground">
                Historia i logi w bazie, wspólne na wszystkich urządzeniach. Wymaga klucza Gemini.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !prefs || !geminiLinked}
              onClick={() =>
                updatePref({
                  chatRouting: prefs?.chatRouting === "server" ? "client" : "server",
                })
              }
              className={toggleClass}
              style={{
                color:
                  prefs?.chatRouting === "server" ? "var(--success)" : "var(--muted-foreground)",
              }}
            >
              {prefs?.chatRouting === "server" ? "● SERWER" : "○ PRZEGLĄDARKA"}
            </button>
          </div>
          <div className="flex flex-col gap-2 border-t border-primary/20 pt-3 @min-[560px]:flex-row @min-[560px]:items-start @min-[560px]:justify-between @min-[560px]:gap-4">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Model J.A.R.V.I.S.-a</p>
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
              className="font-mono w-full min-w-0 border border-primary/60 bg-black/60 px-3 py-1.5 text-xs text-primary outline-none focus:border-primary disabled:opacity-40 @min-[560px]:w-auto @min-[560px]:min-w-[220px]"
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
            <div className="min-w-0">
              <p className="text-sm text-foreground">Język odpowiedzi głosowych</p>
              <p className="text-xs text-muted-foreground">Auto = język Twojej wiadomości.</p>
            </div>
            <div className="flex gap-2">
              {(["auto", "en", "pl"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  disabled={busy || !prefs}
                  onClick={() => updatePref({ voiceLanguage: lang })}
                  className={toggleClass}
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
            <div className="min-w-0">
              <p className="text-sm text-foreground">Słowo „Jarvis" na start</p>
              <p className="text-xs text-muted-foreground">
                ON: potrzebne tylko do rozpoczęcia rozmowy, potem 20 s na kontynuację. OFF: słucha
                zawsze.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !prefs}
              onClick={() => updatePref({ wakeWordEnabled: !(prefs?.wakeWordEnabled ?? true) })}
              className={toggleClass}
              style={{
                color: prefs?.wakeWordEnabled ? "var(--success)" : "var(--muted-foreground)",
              }}
            >
              {prefs?.wakeWordEnabled ? "● ON" : "○ OFF"}
            </button>
          </div>
          {errorMsg && (
            <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
              ✕ {errorMsg}
            </p>
          )}
        </div>
      </HudPanel>

      <HudPanel index={2} title="NARZĘDZIA" tone="quiet" className="p-5">
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Wyłączonego narzędzia J.A.R.V.I.S. nie zaproponuje modelowi przy kolejnej rozmowie.
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
              <div className="min-w-0">
                <p className="break-words text-sm text-foreground">
                  {tool.name}
                  {!tool.globallyEnabled && (
                    <span
                      className="ml-2 font-mono text-[10px] uppercase tracking-widest"
                      style={{ color: "var(--destructive)" }}
                    >
                      WYŁĄCZONE GLOBALNIE
                    </span>
                  )}
                </p>
                {tool.description && (
                  <p className="break-words text-xs text-muted-foreground">{tool.description}</p>
                )}
              </div>
              <button
                type="button"
                disabled={pendingToolId === tool.id || !tool.globallyEnabled}
                onClick={() => handleToggleTool(tool)}
                className={toggleClass}
                style={{
                  color: tool.enabledForAgent ? "var(--success)" : "var(--muted-foreground)",
                }}
              >
                {tool.enabledForAgent ? "● ON" : "○ OFF"}
              </button>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}

function NotificationsSection() {
  return (
    <div className="space-y-6">
      <HudPanel index={1} title="POWIADOMIENIA NA URZĄDZENIA" className="p-5">
        <p className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
          Meldunki zawsze trafiają na dzwonek w aplikacji. Tu włączasz je też na telefonie, gdy
          aplikacja jest zamknięta — osobno w każdej przeglądarce (iPhone: po dodaniu do ekranu
          początkowego).
        </p>
        <div className="mt-4 space-y-4">
          <PushToggle />
          <PushTestButton />
        </div>
      </HudPanel>
      <HudPanel index={2} title="PORANNY BRIEFING" tone="quiet" className="p-5">
        <div className="mt-3">
          <BriefScheduleControls />
          <BriefDelivery />
        </div>
      </HudPanel>
    </div>
  );
}

function LookSection() {
  const { settings, set } = useAudioSettings();
  return (
    <div className="space-y-6">
      <UiModeSettings index={1} />
      <HudPanel index={2} title="DŹWIĘK" tone="quiet" className="p-5">
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                Głośność
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
          <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Szum reaktora</p>
              <p className="text-xs text-muted-foreground">Niski dźwięk tła podczas sesji.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !settings.hum;
                set({ hum: next });
                if (next) audio.startHum();
              }}
              className={toggleClass}
              style={{ color: settings.hum ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {settings.hum ? "● ON" : "○ OFF"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Dźwięki interfejsu</p>
              <p className="text-xs text-muted-foreground">Kliknięcia i sygnały.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                set({ ui: !settings.ui });
                audio.playClick();
              }}
              className={toggleClass}
              style={{ color: settings.ui ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {settings.ui ? "● ON" : "○ OFF"}
            </button>
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
