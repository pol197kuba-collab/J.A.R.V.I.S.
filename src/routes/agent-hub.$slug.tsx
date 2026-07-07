import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { AgentReactorSigil } from "@/components/jarvis/AgentReactorSigil";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearAgentConversations,
  getAgentDetail,
  resetAgentStats,
  setAgentToolEnabled,
  updateAgentSettings,
  type AgentBehaviourConfig,
  type AgentDetail,
  type AgentRunRecord,
  type AgentToolSummary,
} from "@/lib/agents/runtime.functions";
import { audio } from "@/lib/audio/AudioEngine";

export const Route = createFileRoute("/agent-hub/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `JARVIS // Agent · ${params.slug}` },
      { name: "description", content: `Console for JARVIS agent ${params.slug}.` },
    ],
  }),
  component: AgentConsole,
});

const statusColor: Record<string, string> = {
  active: "var(--success)",
  running: "var(--success)",
  done: "var(--success)",
  idle: "var(--muted-foreground)",
  pending: "var(--primary)",
  error: "var(--destructive)",
};

function AgentConsole() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchDetail = useServerFn(getAgentDetail);
  const persistSettings = useServerFn(updateAgentSettings);
  const persistTool = useServerFn(setAgentToolEnabled);
  const resetStats = useServerFn(resetAgentStats);
  const clearConvs = useServerFn(clearAgentConversations);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["agent", slug],
    queryFn: () => fetchDetail({ data: { slug } }),
    refetchInterval: 5000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["agent", slug] });
    qc.invalidateQueries({ queryKey: ["agents", "list"] });
  };

  const settingsMutation = useMutation({
    mutationFn: (patch: SettingsPatch) => persistSettings({ data: { slug, patch } }),
    onSuccess: () => {
      audio.playClick();
      invalidate();
    },
  });

  const toolMutation = useMutation({
    mutationFn: (v: { toolId: string; enabled: boolean }) =>
      persistTool({ data: { agentSlug: slug, toolId: v.toolId, enabled: v.enabled } }),
    onSuccess: () => {
      audio.playClick();
      invalidate();
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetStats({ data: { slug } }),
    onSuccess: () => {
      audio.playClick();
      invalidate();
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearConvs({ data: { slug } }),
    onSuccess: () => {
      audio.playClick();
      invalidate();
    },
  });

  const [runDetail, setRunDetail] = useState<AgentRunRecord | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <HudPanel index={0} className="p-5">
          <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            ▸ SYNCHRONISING AGENT TELEMETRY…
          </p>
        </HudPanel>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6 p-6">
        <HudPanel index={0} className="p-5">
          <p className="font-display text-xs uppercase tracking-widest" style={{ color: "var(--destructive)" }}>
            ✕ AGENT UNREACHABLE — {error instanceof Error ? error.message : "unknown"}
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/agent-hub" })}
            className="font-display mt-4 border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest text-primary"
          >
            ← BACK TO AGENT HUB
          </button>
        </HudPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Header data={data} onBack={() => navigate({ to: "/agent-hub" })} />
      <TelemetryPanel data={data} />
      <LiveRunsPanel data={data} onOpenRun={setRunDetail} />
      <ToolsPanel
        data={data}
        onToggle={(t) => toolMutation.mutate({ toolId: t.id, enabled: !t.enabledForAgent })}
        pending={toolMutation.isPending}
      />
      <MemoryPanel data={data} />
      <SettingsPanel
        data={data}
        onSave={(patch) => settingsMutation.mutate(patch)}
        saving={settingsMutation.isPending}
        savedAt={settingsMutation.isSuccess ? settingsMutation.submittedAt : null}
        error={settingsMutation.error instanceof Error ? settingsMutation.error.message : null}
      />
      <LifecyclePanel
        data={data}
        onToggleEnabled={(next) => settingsMutation.mutate({ isEnabled: next })}
        onResetStats={() => resetMutation.mutate()}
        onClearConversations={() => {
          if (window.confirm(`Wykasować wszystkie konwersacje agenta ${data.agent.slug}?`)) {
            clearMutation.mutate();
          }
        }}
        resetting={resetMutation.isPending}
        clearing={clearMutation.isPending}
      />
      <EventLogPanel data={data} />

      <Dialog open={!!runDetail} onOpenChange={(o) => !o && setRunDetail(null)}>
        <DialogContent className="max-w-3xl border-primary/40 bg-black/95">
          <DialogHeader>
            <DialogTitle className="font-display text-xs uppercase tracking-[0.3em] text-primary">
              RUN {runDetail?.id.slice(0, 8)} · {runDetail?.status}
            </DialogTitle>
          </DialogHeader>
          {runDetail && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-muted-foreground">
                <span>created · {new Date(runDetail.createdAt).toLocaleString()}</span>
                <span>latency · {runDetail.latencyMs ?? "—"} ms</span>
                <span>tokens in · {runDetail.tokensIn ?? "—"}</span>
                <span>tokens out · {runDetail.tokensOut ?? "—"}</span>
              </div>
              {runDetail.error && (
                <pre className="max-h-40 overflow-auto border border-destructive/50 bg-destructive/10 p-2 font-mono text-[11px]" style={{ color: "var(--destructive)" }}>
                  {runDetail.error}
                </pre>
              )}
              <JsonBlock label="INPUT" value={runDetail.input} />
              <JsonBlock label="OUTPUT" value={runDetail.output} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ data, onBack }: { data: AgentDetail; onBack: () => void }) {
  const a = data.agent;
  const status = data.stats.lastRunStatus ?? a.status;
  const uptimeDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86_400_000),
  );
  return (
    <HudPanel index={0} className="p-6">
      <button
        type="button"
        onClick={onBack}
        className="font-display mb-4 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-primary/80 hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> BACK
      </button>
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-8">
        <AgentReactorSigil slug={a.slug} size={180} active={a.isEnabled} />
        <div className="flex-1 space-y-2 text-center md:text-left">
          <p className="font-display text-[10px] uppercase tracking-[0.4em] text-primary/80">
            SUBSYSTEM // AGENT CONSOLE
          </p>
          <h1 className="font-display text-4xl font-bold tracking-[0.18em]">{a.name}</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {a.role ?? "unassigned"} · slug {a.slug}
          </p>
          {a.description && (
            <p className="mx-auto max-w-xl text-xs text-muted-foreground/90 md:mx-0">
              {a.description}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-4 pt-2 md:justify-start">
            <StatusPill
              label={a.isEnabled ? status : "disabled"}
              color={a.isEnabled ? statusColor[status] ?? "var(--primary)" : "var(--muted-foreground)"}
            />
            <StatusPill label={`model · ${data.effectiveModel}`} color="var(--primary)" />
            <StatusPill label={`uptime · ${uptimeDays}d`} color="var(--muted-foreground)" />
            <StatusPill
              label={`updated · ${new Date(a.updatedAt).toLocaleDateString()}`}
              color="var(--muted-foreground)"
            />
          </div>
        </div>
      </div>
    </HudPanel>
  );
}

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-display inline-flex items-center gap-2 border px-2 py-1 text-[10px] uppercase tracking-widest"
      style={{ borderColor: `${color}55`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

function TelemetryPanel({ data }: { data: AgentDetail }) {
  const s = data.stats;
  const successPct = s.successRate === null ? "—" : `${Math.round(s.successRate * 100)}%`;
  return (
    <HudPanel index={1} title="TELEMETRY // AGENT LOAD" className="p-5">
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="RUNS · TOTAL" value={s.runsTotal.toString()} />
        <Metric label="RUNS · 24H" value={s.runs24h.toString()} sub={`${s.runsErr24h} err`} />
        <Metric label="RUNS · 7D" value={s.runs7d.toString()} />
        <Metric label="SUCCESS RATE" value={successPct} />
        <Metric label="AVG LATENCY" value={s.avgLatencyMs === null ? "—" : `${s.avgLatencyMs} ms`} />
        <Metric label="P95 LATENCY" value={s.p95LatencyMs === null ? "—" : `${s.p95LatencyMs} ms`} />
        <Metric label="TOKENS IN · TOTAL" value={s.tokensInTotal.toLocaleString()} sub={`${s.tokensIn24h} · 24h`} />
        <Metric label="TOKENS OUT · TOTAL" value={s.tokensOutTotal.toLocaleString()} sub={`${s.tokensOut24h} · 24h`} />
      </div>
      <div className="mt-6 border-t border-primary/20 pt-4">
        <p className="font-display mb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          RUNS / HR · LAST 24
        </p>
        <Sparkline values={s.sparkline} />
      </div>
    </HudPanel>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="font-display text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </p>
      <p className="font-display mt-1 text-2xl font-semibold text-primary">{value}</p>
      {sub && <p className="font-mono text-[10px] text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-16 items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-primary/70"
          style={{
            height: `${Math.max(4, (v / max) * 100)}%`,
            opacity: v === 0 ? 0.15 : 0.55 + (v / max) * 0.45,
          }}
          title={`${23 - i}h ago · ${v} run(s)`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live runs
// ---------------------------------------------------------------------------

function LiveRunsPanel({
  data,
  onOpenRun,
}: {
  data: AgentDetail;
  onOpenRun: (r: AgentRunRecord) => void;
}) {
  return (
    <HudPanel index={2} title="ACTIVITY // RUN STREAM" className="p-5">
      {data.activeRuns.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="font-display text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--primary)" }}>
            ● {data.activeRuns.length} ACTIVE
          </p>
          {data.activeRuns.map((r) => (
            <ActiveRow key={r.id} run={r} />
          ))}
        </div>
      )}
      <div className="mt-4">
        <p className="font-display mb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          RECENT · {data.recentRuns.length}
        </p>
        {data.recentRuns.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground/70">
            NO TELEMETRY — AGENT AWAITING FIRST TASK.
          </p>
        )}
        <div className="divide-y divide-primary/15">
          {data.recentRuns.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenRun(r)}
              className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-primary/5"
            >
              <span
                className="font-display shrink-0 text-[10px] uppercase tracking-widest"
                style={{ color: statusColor[r.status] ?? "var(--muted-foreground)" }}
              >
                ● {r.status}
              </span>
              <span className="font-mono flex-1 truncate text-[11px] text-foreground">
                {inputPreview(r.input)}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {r.latencyMs ? `${r.latencyMs}ms` : "—"} · {new Date(r.createdAt).toLocaleTimeString()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function ActiveRow({ run }: { run: AgentRunRecord }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const startMs = run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  return (
    <div className="flex items-center justify-between gap-3 border border-primary/25 bg-primary/5 px-3 py-2">
      <span className="font-mono text-[11px] text-foreground truncate">{inputPreview(run.input)}</span>
      <span className="font-mono shrink-0 text-[10px] text-primary">▸ {elapsed}s</span>
    </div>
  );
}

function inputPreview(input: unknown): string {
  if (input && typeof input === "object" && "text" in (input as Record<string, unknown>)) {
    const t = (input as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  try {
    return JSON.stringify(input).slice(0, 160);
  } catch {
    return String(input);
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function ToolsPanel({
  data,
  onToggle,
  pending,
}: {
  data: AgentDetail;
  onToggle: (t: AgentToolSummary) => void;
  pending: boolean;
}) {
  return (
    <HudPanel index={3} title="ARSENAL // TOOL BINDINGS" className="p-5">
      <div className="mt-3 space-y-3">
        {data.tools.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground/70">
            NO TOOLS REGISTERED IN THE GLOBAL CATALOG.
          </p>
        )}
        {data.tools.map((t, i) => {
          const u24 = data.toolUsage24h[t.slug] ?? 0;
          const u7d = data.toolUsage7d[t.slug] ?? 0;
          return (
            <div
              key={t.id}
              className={`flex items-start justify-between gap-3 ${i > 0 ? "border-t border-primary/20 pt-3" : ""}`}
            >
              <div className="flex-1">
                <p className="text-sm text-foreground">
                  {t.name}
                  {!t.globallyEnabled && (
                    <span
                      className="font-display ml-2 text-[10px] uppercase tracking-widest"
                      style={{ color: "var(--destructive)" }}
                    >
                      GLOBALLY DISABLED
                    </span>
                  )}
                </p>
                {t.description && (
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                )}
                <p className="font-mono mt-1 text-[10px] text-muted-foreground/70">
                  usage · {u24} · 24h / {u7d} · 7d
                </p>
              </div>
              <button
                type="button"
                disabled={pending || !t.globallyEnabled}
                onClick={() => onToggle(t)}
                className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
                style={{ color: t.enabledForAgent ? "var(--success)" : "var(--muted-foreground)" }}
              >
                {t.enabledForAgent ? "● ON" : "○ OFF"}
              </button>
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function MemoryPanel({ data }: { data: AgentDetail }) {
  const kinds = Object.entries(data.memoriesByKind);
  return (
    <HudPanel index={4} title="MEMORY // CONTEXT" className="p-5">
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            CONVERSATIONS
          </p>
          <p className="font-display mt-1 text-2xl font-semibold text-primary">
            {data.conversationsCount}
          </p>
          <div className="mt-2 space-y-1">
            {data.recentConversations.length === 0 && (
              <p className="font-mono text-[10px] text-muted-foreground/70">
                brak archiwum konwersacji
              </p>
            )}
            {data.recentConversations.map((c) => (
              <p key={c.id} className="font-mono text-[11px] text-foreground/90">
                · {c.title ?? "(untitled)"} — {new Date(c.updatedAt).toLocaleString()}
              </p>
            ))}
          </div>
        </div>
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            MEMORY ENTRIES BY KIND
          </p>
          {kinds.length === 0 ? (
            <p className="font-mono mt-2 text-[10px] text-muted-foreground/70">
              agent nie zapisał jeszcze żadnej pamięci
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {kinds.map(([k, n]) => (
                <li key={k} className="font-mono flex justify-between text-[11px]">
                  <span className="text-foreground/90">{k}</span>
                  <span className="text-primary">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// Settings — identity / model / behaviour
// ---------------------------------------------------------------------------

type SettingsPatch = {
  name?: string;
  role?: string | null;
  description?: string | null;
  model?: "gemini-2.5-flash" | "gemini-2.5-pro" | null;
  isEnabled?: boolean;
  behaviour?: Partial<AgentBehaviourConfig>;
};

function SettingsPanel({
  data,
  onSave,
  saving,
  savedAt,
  error,
}: {
  data: AgentDetail;
  onSave: (patch: SettingsPatch) => void;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
}) {
  const a = data.agent;
  const b = a.behaviour;
  const [name, setName] = useState(a.name);
  const [role, setRole] = useState(a.role ?? "");
  const [description, setDescription] = useState(a.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(b.systemPromptOverride ?? "");
  const [temperature, setTemperature] = useState<number>(b.temperature ?? 0.85);
  const [maxOutTokens, setMaxOutTokens] = useState<number>(b.maxOutputTokens ?? 1600);
  const [maxToolIter, setMaxToolIter] = useState<number>(b.maxToolIterations ?? 6);

  // Refresh local state if server state changes (e.g. another tab).
  useEffect(() => setName(a.name), [a.name]);
  useEffect(() => setRole(a.role ?? ""), [a.role]);
  useEffect(() => setDescription(a.description ?? ""), [a.description]);
  useEffect(() => setSystemPrompt(b.systemPromptOverride ?? ""), [b.systemPromptOverride]);
  useEffect(() => setTemperature(b.temperature ?? 0.85), [b.temperature]);
  useEffect(() => setMaxOutTokens(b.maxOutputTokens ?? 1600), [b.maxOutputTokens]);
  useEffect(() => setMaxToolIter(b.maxToolIterations ?? 6), [b.maxToolIterations]);

  const modelInherit = a.model === null;
  const currentModel = a.model ?? data.effectiveModel;

  const savePartial = (patch: SettingsPatch) => onSave(patch);
  const saveBehaviour = (patch: Partial<AgentBehaviourConfig>) =>
    onSave({ behaviour: patch });

  return (
    <HudPanel index={5} title="AGENT SETTINGS // BEHAVIOUR" className="p-5">
      <div className="mt-3 space-y-5">
        {/* Identity */}
        <div className="space-y-2">
          <SectionLabel>IDENTITY</SectionLabel>
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            onCommit={(v) => v !== a.name && v.trim() && savePartial({ name: v.trim() })}
          />
          <TextField
            label="Role"
            value={role}
            onChange={setRole}
            onCommit={(v) =>
              v !== (a.role ?? "") && savePartial({ role: v.trim() ? v.trim() : null })
            }
          />
          <TextareaField
            label="Description"
            value={description}
            onChange={setDescription}
            onCommit={(v) =>
              v !== (a.description ?? "") &&
              savePartial({ description: v.trim() ? v.trim() : null })
            }
            rows={2}
          />
        </div>

        {/* Model */}
        <div className="space-y-2 border-t border-primary/20 pt-4">
          <SectionLabel>MODEL</SectionLabel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">Inherit from global default</p>
              <p className="text-xs text-muted-foreground">
                Gdy on = używa modelu z Settings ({data.effectiveModel}).
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                savePartial({ model: modelInherit ? "gemini-2.5-flash" : null })
              }
              className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest"
              style={{ color: modelInherit ? "var(--success)" : "var(--muted-foreground)" }}
            >
              {modelInherit ? "● INHERIT" : "○ OVERRIDE"}
            </button>
          </div>
          {!modelInherit && (
            <div className="flex gap-2">
              {(["gemini-2.5-flash", "gemini-2.5-pro"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => savePartial({ model: m })}
                  className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest"
                  style={{
                    color: currentModel === m ? "var(--primary)" : "var(--muted-foreground)",
                    background: currentModel === m ? "rgba(56,189,248,0.1)" : "transparent",
                  }}
                >
                  {m.replace("gemini-2.5-", "")}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Behaviour */}
        <div className="space-y-4 border-t border-primary/20 pt-4">
          <SectionLabel>BEHAVIOUR</SectionLabel>
          <TextareaField
            label="System prompt override"
            placeholder="(opcjonalnie — nadpisuje domyślną personę JARVIS-a dla tego agenta)"
            value={systemPrompt}
            onChange={setSystemPrompt}
            onCommit={(v) =>
              v !== (b.systemPromptOverride ?? "") &&
              saveBehaviour({ systemPromptOverride: v.trim() ? v : null })
            }
            rows={5}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <SliderField
              label={`Temperature · ${temperature.toFixed(2)}`}
              min={0}
              max={1}
              step={0.05}
              value={temperature}
              onChange={setTemperature}
              onCommit={(v) => v !== (b.temperature ?? 0.85) && saveBehaviour({ temperature: v })}
            />
            <NumberField
              label="Max output tokens"
              min={64}
              max={8192}
              step={64}
              value={maxOutTokens}
              onChange={setMaxOutTokens}
              onCommit={(v) =>
                v !== (b.maxOutputTokens ?? 1600) && saveBehaviour({ maxOutputTokens: v })
              }
            />
            <NumberField
              label="Max tool iterations"
              min={1}
              max={12}
              step={1}
              value={maxToolIter}
              onChange={setMaxToolIter}
              onCommit={(v) =>
                v !== (b.maxToolIterations ?? 6) && saveBehaviour({ maxToolIterations: v })
              }
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-primary/20 pt-3">
          <p className="font-mono text-[10px] text-muted-foreground/70">
            zmiany zapisywane automatycznie po opuszczeniu pola
          </p>
          <p
            className="font-display text-[10px] uppercase tracking-widest"
            style={{
              color: error
                ? "var(--destructive)"
                : saving
                  ? "var(--primary)"
                  : savedAt
                    ? "var(--success)"
                    : "var(--muted-foreground)",
            }}
          >
            {error
              ? `✕ ${error}`
              : saving
                ? "◐ SAVING…"
                : savedAt
                  ? "✓ SAVED"
                  : "○ IDLE"}
          </p>
        </div>
      </div>
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function LifecyclePanel({
  data,
  onToggleEnabled,
  onResetStats,
  onClearConversations,
  resetting,
  clearing,
}: {
  data: AgentDetail;
  onToggleEnabled: (next: boolean) => void;
  onResetStats: () => void;
  onClearConversations: () => void;
  resetting: boolean;
  clearing: boolean;
}) {
  const enabled = data.agent.isEnabled;
  return (
    <HudPanel index={6} title="LIFECYCLE // CONTROLS" className="p-5">
      <div className="mt-3 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground">Agent kill-switch</p>
            <p className="text-xs text-muted-foreground">
              Wyłączony agent nie odbiera zadań (runAgent zwróci błąd Orchestratora).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onToggleEnabled(!enabled)}
            className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest"
            style={{ color: enabled ? "var(--success)" : "var(--destructive)" }}
          >
            {enabled ? "● ONLINE" : "○ OFFLINE"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
          <div>
            <p className="text-sm text-foreground">Reset stats marker</p>
            <p className="text-xs text-muted-foreground">
              Zapisuje w event logu punkt zerowania. Historyczne runy zostają.
            </p>
          </div>
          <button
            type="button"
            disabled={resetting}
            onClick={onResetStats}
            className="font-display border border-primary/60 px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
          >
            {resetting ? "…" : "MARK"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
          <div>
            <p className="text-sm text-foreground">Clear conversations</p>
            <p className="text-xs text-muted-foreground">
              Trwale usuwa wszystkie konwersacje agenta (kaskaduje na messages).
            </p>
          </div>
          <button
            type="button"
            disabled={clearing}
            onClick={onClearConversations}
            className="font-display border px-3 py-1 text-[10px] uppercase tracking-widest disabled:opacity-40"
            style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}
          >
            {clearing ? "…" : "PURGE"}
          </button>
        </div>
      </div>
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

function EventLogPanel({ data }: { data: AgentDetail }) {
  return (
    <HudPanel index={7} title="CHRONICLE // EVENT LOG" className="p-5">
      <div className="mt-3">
        {data.events.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground/70">
            NO EVENTS RECORDED FOR THIS AGENT YET.
          </p>
        )}
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {data.events.map((e) => (
            <div
              key={`${e.origin}-${e.id}`}
              className="font-mono border-l-2 pl-2 text-[11px]"
              style={{ borderColor: levelColor(e.level) }}
            >
              <span className="text-muted-foreground/70">
                {new Date(e.createdAt).toLocaleTimeString()}{" "}
              </span>
              <span style={{ color: levelColor(e.level) }}>[{e.level}]</span>{" "}
              <span className="text-primary/80">{e.source}</span>{" "}
              <span className="text-foreground/90">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </HudPanel>
  );
}

function levelColor(level: string): string {
  if (level === "error") return "var(--destructive)";
  if (level === "warn") return "oklch(0.75 0.15 80)";
  return "var(--primary)";
}

// ---------------------------------------------------------------------------
// Field primitives + JSON viewer
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/70">
      {children}
    </p>
  );
}

function TextField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        className="font-mono mt-1 w-full border border-primary/40 bg-black/40 px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  onCommit,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        className="font-mono mt-1 w-full resize-y border border-primary/40 bg-black/40 px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={(e) => onCommit(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="font-mono mt-1 w-full border border-primary/40 bg-black/40 px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function SliderField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="mt-2 w-full accent-[color:var(--primary)]"
      />
    </label>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true);
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <div className="border border-primary/25">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="font-display flex w-full items-center gap-2 border-b border-primary/25 bg-primary/5 px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-primary/80"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {label}
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto bg-black/50 p-2 font-mono text-[11px] text-foreground/90">
          {text}
        </pre>
      )}
    </div>
  );
}