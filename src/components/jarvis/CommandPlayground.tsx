import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, SendHorizonal, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceCommands } from "./VoiceCommandContext";
import { useSingleVoiceCommand } from "./useSingleVoiceCommand";
import { onChat, type ChatBusMessage } from "@/lib/ai/chatBus";
import { COMMAND_REGISTRY, type CommandCategory } from "@/lib/commands/registry";

// A live test bench for every command in COMMAND_REGISTRY — text AND voice —
// run through the EXACT SAME pipeline production traffic uses (routeText →
// route() in VoiceCommandContext: local regex first, Gemini fallback
// second). No parallel matcher is reimplemented here, so this can never
// drift from what actually fires when a user speaks or types.
//
// Deliberately does NOT reuse useAgentChatChannel: that hook shares one
// persistent conversation across every chat surface in the app (Dashboard,
// /jarvis, Agent Hub), and flooding it with test phrases would pollute the
// user's real assistant history. This keeps its own session-scoped log —
// still fed by the same jarvis:chat bus routeText() publishes to, just not
// loaded from or written back to the persisted transcript.

const CATEGORY_COLOR: Record<CommandCategory, string> = {
  Navigation: "var(--primary)",
  Interface: "var(--accent, var(--primary))",
  System: "var(--destructive, #ff5577)",
};

export function CommandPlayground() {
  const {
    routeText,
    enabled: continuousListeningEnabled,
    setEnabled: setContinuousListening,
  } = useVoiceCommands();
  const { supported: micSupported, listening: capturing, capture } = useSingleVoiceCommand();
  const [input, setInput] = useState("");
  const [log, setLog] = useState<ChatBusMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => onChat((msg) => setLog((prev) => [...prev, msg].slice(-50))), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [log, busy]);

  // Live preview: does the CURRENT input already match a local regex, or
  // will it fall through to Gemini for interpretation? Pure client-side
  // regex test against the same registry the production matcher uses — no
  // network call, updates on every keystroke.
  const localMatch = useMemo(() => {
    const text = input.trim();
    if (!text) return null;
    return COMMAND_REGISTRY.find((c) => c.pattern.test(text)) ?? null;
  }, [input]);

  async function fire(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setBusy(true);
    try {
      await routeText(clean);
    } finally {
      setBusy(false);
    }
  }

  async function handleMicClick() {
    if (capturing) return;
    // The global wake-word listener and this one-shot capture can't both
    // hold the microphone — same guard MatrixChatConsole uses.
    if (continuousListeningEnabled) setContinuousListening(false);
    const transcript = await capture();
    if (transcript) void fire(transcript);
  }

  return (
    <div className="flex h-[520px] flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/15 bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />
          <span className="font-display text-[9px] uppercase tracking-[0.28em] text-primary/90">
            Command Playground // Live Test Bench
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
            {busy ? "resolving…" : "idle"}
          </span>
          {log.length > 0 && (
            <button
              type="button"
              onClick={() => setLog([])}
              aria-label="Clear session log"
              title="Clear session log"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Session log */}
      <div
        ref={scrollRef}
        className="no-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-4 py-3"
      >
        {log.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center opacity-60">
            <p className="font-display text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
              Test bench idle — type, click a phrase chip, or speak
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/70">
              Runs through the exact same pipeline production commands use.
            </p>
          </div>
        )}
        {log.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div className={cn("min-w-0 max-w-[85%] space-y-1", m.role === "user" && "text-right")}>
              <p
                className={cn(
                  "font-display text-[8px] uppercase tracking-[0.26em]",
                  m.role === "jarvis" ? "text-primary" : "text-muted-foreground",
                )}
              >
                {m.role === "jarvis" ? "JARVIS //" : "TEST INPUT //"} {m.time}
              </p>
              <div
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-words rounded-lg border px-3 py-2 font-mono text-[11px] leading-snug",
                  m.role === "jarvis"
                    ? "border-primary/25 bg-primary/[0.06] text-foreground"
                    : "border-border/50 bg-secondary/30 text-foreground",
                )}
              >
                {m.text}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2">
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary" />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="shrink-0 space-y-2 border-t border-primary/15 bg-black/20 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            local match preview //
          </span>
          {localMatch ? (
            <span
              className="font-display flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em]"
              style={{ color: CATEGORY_COLOR[localMatch.category] }}
            >
              ◢ instant match: <code className="text-foreground">{localMatch.id}</code>
            </span>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
              {input.trim() ? "no local match — will ask Gemini" : "—"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-black/50 px-2 py-1.5 shadow-[0_0_24px_-12px_color-mix(in_oklab,var(--primary)_60%,transparent)] focus-within:border-primary/60">
          <span className="font-mono text-[11px] text-primary/70">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void fire(input);
              }
            }}
            placeholder="type a command to test…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={!micSupported}
            onClick={handleMicClick}
            aria-label="Speak a command"
            title={micSupported ? "Speak a command" : "Voice input unsupported in this browser"}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
              capturing
                ? "border-primary bg-primary/20 text-primary shadow-[0_0_14px_-4px_var(--primary)]"
                : "border-primary/25 text-primary/70 hover:bg-primary/10",
              !micSupported && "opacity-40",
            )}
          >
            {capturing ? (
              <MicOff className="h-3.5 w-3.5" strokeWidth={1.5} />
            ) : (
              <Mic className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={() => void fire(input)}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-2.5 font-display text-[8px] uppercase tracking-[0.22em] text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizonal className="h-3 w-3" strokeWidth={1.5} />
            run
          </button>
        </div>

        {/* One-click phrase chips — smoke-test every registered command
            without typing it out. Generated straight from the registry, so
            a new command gets a chip for free. */}
        <div className="no-scrollbar flex max-h-[104px] flex-wrap gap-1.5 overflow-y-auto pt-0.5">
          {COMMAND_REGISTRY.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => void fire(c.phrases[0] ?? c.id)}
              title={c.phrases[0]}
              className="rounded-full border px-2.5 py-1 font-mono text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: `color-mix(in oklab, ${CATEGORY_COLOR[c.category]} 40%, transparent)`,
                color: `color-mix(in oklab, ${CATEGORY_COLOR[c.category]} 85%, var(--foreground))`,
                backgroundColor: `color-mix(in oklab, ${CATEGORY_COLOR[c.category]} 6%, transparent)`,
              }}
            >
              {c.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
