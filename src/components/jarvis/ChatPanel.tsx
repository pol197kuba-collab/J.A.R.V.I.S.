import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { emitChat, getRecentHistory, onChat, type ChatBusMessage } from "@/lib/ai/chatBus";
import { useVoiceCommands } from "./VoiceCommandContext";
import { runAgent } from "@/lib/agents/runtime.functions";
import { speak } from "@/lib/audio/speak";
import { ACTIVE_AGENT_LS_KEY } from "@/routes/agent-hub";

const STORAGE_KEY = "jarvis_chat_history";
const MAX_HISTORY = 60;
const SERVER_KEY_LINKED_LS_KEY = "jarvis_server_gemini_linked";

// Domyślny agent gdy żaden nie jest wybrany z Agent Hub
const DEFAULT_AGENT = { slug: "orchestrator", name: "ORCHESTRATOR" };

type ActiveAgent = { slug: string; name: string };

function readActiveAgent(): ActiveAgent {
  if (typeof window === "undefined") return DEFAULT_AGENT;
  try {
    const raw = window.localStorage.getItem(ACTIVE_AGENT_LS_KEY);
    if (!raw) return DEFAULT_AGENT;
    const parsed = JSON.parse(raw) as ActiveAgent;
    return parsed.slug && parsed.name ? parsed : DEFAULT_AGENT;
  } catch {
    return DEFAULT_AGENT;
  }
}

function hasServerKey(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SERVER_KEY_LINKED_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function loadHistory(): ChatBusMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatBusMessage[];
  } catch {
    return [];
  }
}

function saveHistory(items: ChatBusMessage[]) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.slice(-MAX_HISTORY)),
    );
  } catch {
    /* ignore */
  }
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatBusMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);

  // Aktywny agent — czytany z localStorage, aktualizowany przez event z Agent Hub
  const [activeAgent, setActiveAgent] = useState<ActiveAgent>(() => readActiveAgent());

  const scrollRef = useRef<HTMLDivElement>(null);
  const { routeText } = useVoiceCommands();
  const qc = useQueryClient();
  const runAgentFn = useServerFn(runAgent);
  const noticeShownRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  // Słuchaj na zmianę agenta z Agent Hub (przycisk LAUNCH)
  useEffect(() => {
    function handleAgentChanged(e: Event) {
      const detail = (e as CustomEvent<ActiveAgent>).detail;
      if (!detail?.slug || !detail?.name) return;

      setActiveAgent(detail);

      // Reset historii — nowy agent, nowy kontekst
      setMessages([]);
      saveHistory([]);
      noticeShownRef.current = false;
    }

    window.addEventListener("jarvis:agent-changed", handleAgentChanged);
    return () => window.removeEventListener("jarvis:agent-changed", handleAgentChanged);
  }, []);

  // Subscribe to the global chat bus
  useEffect(() => {
    return onChat((msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg].slice(-MAX_HISTORY);
        saveHistory(next);
        return next;
      });
      if (msg.role === "jarvis") setTyping(false);
    });
  }, []);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setTyping(true);
    try {
      if (hasServerKey()) {
        emitChat("user", text);
        const history = getRecentHistory(10);
        try {
          const result = await runAgentFn({
            // Używamy aktywnego agenta zamiast hardkodowanego "orchestrator"
            data: { agentSlug: activeAgent.slug, input: text, history },
          });
          const reply =
            result.status === "done" && result.output
              ? result.output
              : `⚠ Agent error: ${result.error ?? "unknown"}`;
          emitChat("jarvis", reply);
          if (result.status === "done") speak(reply);
          qc.invalidateQueries({ queryKey: ["notes", "list"] });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emitChat("jarvis", `⚠ Agent runtime failed: ${msg}`);
        }
      } else {
        await routeText(text);
        if (!noticeShownRef.current) {
          noticeShownRef.current = true;
          emitChat(
            "jarvis",
            "⚠ Tool-calling offline — save your Gemini key in Settings → Agent Runtime to unlock web_search / save_note / fetch_url.",
          );
        }
      }
    } finally {
      setTyping(false);
    }
  }

  // Nazwa agenta do wyświetlenia w UI — zawsze uppercase
  const agentLabel = activeAgent.name.toUpperCase();

  return (
    <div className="flex h-[420px] flex-col">
      <div className="flex items-center justify-between border-b border-primary/20 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-blink rounded-full" style={{ backgroundColor: "var(--success)" }} />
          {/* Nazwa aktywnego agenta zamiast statycznego "DUPLEX CHANNEL // GEMINI CORE" */}
          <span className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            ACTIVE AGENT // {agentLabel}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                saveHistory([]);
              }}
              className="font-display text-[9px] uppercase tracking-[0.3em] text-muted-foreground transition hover:text-destructive"
            >
              CLEAR
            </button>
          )}
          <span className="font-display text-[10px] uppercase tracking-widest text-primary/70 landscape:max-md:hidden">
            SECURE // ENCRYPTED
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            ▸ CHANNEL CLEAR. TRANSMIT INSTRUCTION TO BEGIN.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div className={cn("max-w-[80%] space-y-1", m.role === "user" && "text-right")}>
              <p
                className={cn(
                  "font-display text-[10px] uppercase tracking-widest",
                  m.role === "jarvis" ? "text-primary" : "text-muted-foreground",
                )}
              >
                {/* Nazwa agenta zamiast statycznego "J.A.R.V.I.S //" */}
                {m.role === "jarvis" ? `${agentLabel} //` : "USER //"} {m.time}
              </p>
              <div
                className={cn(
                  "whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-sm leading-relaxed",
                  m.role === "jarvis"
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-border/60 bg-secondary/40 text-foreground",
                )}
              >
                {m.text}
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-1">
              <p className="font-display text-[10px] uppercase tracking-widest text-primary">
                {agentLabel} //
              </p>
              <div className="flex gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-3">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary" />
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 border-t border-border/60 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="▸ TRANSMIT INSTRUCTION…"
          className="flex-1 border border-primary/40 bg-black/60 px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          className="flex h-10 w-10 items-center justify-center border border-primary/60 bg-primary/10 text-primary transition hover:bg-primary/20 hover:shadow-[var(--glow-primary)]"
          aria-label="Send"
        >
          <Send strokeWidth={1.5} className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
