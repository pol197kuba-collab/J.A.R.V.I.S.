import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { emitChat, getRecentHistory, onChat, type ChatBusMessage } from "@/lib/ai/chatBus";
import type { JarvisAction } from "@/lib/ai/jarvisBrain";
import { useVoiceCommands } from "./VoiceCommandContext";
import {
  listAgents,
  runAgent,
  getActiveConversation,
  clearConversation,
  setActiveAgent as setActiveAgentFn,
  getActiveAgentSlug,
} from "@/lib/agents/runtime.functions";
import { speak } from "@/lib/audio/speak";
import { setAgentBusy, reportOutcome } from "@/lib/ai/agentActivity";
import { LinkifiedText } from "./LinkifiedText";
import { requestOpenDocument } from "@/lib/documents/openDocumentBus";
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

export function ChatPanel() {
  // localStorage daje natychmiastowy render (brak pustego ekranu przy
  // starcie); serwer jest źródłem prawdy i nadpisuje to zaraz po hydratacji
  // — patrz efekty poniżej.
  const [messages, setMessages] = useState<ChatBusMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Aktywny agent — startowo z localStorage (instant paint), zaraz
  // potwierdzany/nadpisywany wartością z konta (user_settings.active_agent_slug)
  // w efekcie poniżej, żeby nowe urządzenie otwierało się na tym samym agencie.
  const [activeAgent, setActiveAgent] = useState<ActiveAgent>(() => readActiveAgent());

  const scrollRef = useRef<HTMLDivElement>(null);
  const { routeText, performAction } = useVoiceCommands();
  const qc = useQueryClient();
  const runAgentFn = useServerFn(runAgent);
  const fetchAgents = useServerFn(listAgents);
  const fetchConversation = useServerFn(getActiveConversation);
  const clearConversationFn = useServerFn(clearConversation);
  const persistActiveAgent = useServerFn(setActiveAgentFn);
  const fetchActiveAgentSlug = useServerFn(getActiveAgentSlug);
  const noticeShownRef = useRef(false);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 15000,
  });

  function switchAgent(slug: string) {
    const found = agents.find((a) => a.slug === slug);
    if (!found) return;
    const next = { slug: found.slug, name: found.name };
    setActiveAgent(next);
    setConversationId(null); // nowy agent → efekt niżej wczyta jego własny wątek
    try {
      window.localStorage.setItem(ACTIVE_AGENT_LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    persistActiveAgent({ data: { agentSlug: found.slug } }).catch(() => {
      /* najwyżej nie zsynchronizuje się na inne urządzenie — nie blokujemy UI */
    });
    // Nie kasujemy historii — rozmowa jest ciągła, tylko zmienia się etykieta
    // tego, kto odpowiada. Dokładamy krótką informację systemową w chacie.
    emitChat("jarvis", `▸ Aktywny agent zmieniony na ${found.name.toUpperCase()}.`, {
      agentSlug: found.slug,
      agentName: found.name,
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  // Jednorazowo przy montowaniu: zapytaj konto, jaki agent był ostatnio
  // wybrany na DOWOLNYM urządzeniu, i przełącz się na niego jeśli różni się
  // od tego, co mamy lokalnie w tej przeglądarce.
  useEffect(() => {
    let cancelled = false;
    fetchActiveAgentSlug()
      .then((res) => {
        if (cancelled || !res.agentSlug) return;
        setActiveAgent((prev) =>
          prev.slug === res.agentSlug ? prev : { slug: res.agentSlug, name: res.agentSlug },
        );
      })
      .catch(() => {
        /* zostań przy lokalnym wyborze */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gdy `agents` się załaduje, dociągnij pełną nazwę aktywnego agenta (na
  // wypadek gdyby powyższy efekt ustawił tylko slug jako placeholder name).
  useEffect(() => {
    if (agents.length === 0) return;
    const found = agents.find((a) => a.slug === activeAgent.slug);
    if (found && found.name !== activeAgent.name) {
      setActiveAgent({ slug: found.slug, name: found.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  // Za każdym razem, gdy zmienia się aktywny agent, wczytaj JEGO wątek z
  // serwera — to jest właściwa synchronizacja historii między urządzeniami.
  useEffect(() => {
    let cancelled = false;
    fetchConversation({ data: { agentSlug: activeAgent.slug } })
      .then((res) => {
        if (cancelled) return;
        setConversationId(res.conversationId);
        if (res.messages.length > 0) {
          setMessages(res.messages);
          saveHistory(res.messages);
        }
      })
      .catch(() => {
        /* offline / błąd sieci — zostań przy lokalnym cache, nic nie psuj */
      });
    return () => {
      cancelled = true;
    };
  }, [activeAgent.slug]);

  // Słuchaj na zmianę agenta z Agent Hub (przycisk LAUNCH)
  useEffect(() => {
    function handleAgentChanged(e: Event) {
      const detail = (e as CustomEvent<ActiveAgent>).detail;
      if (!detail?.slug || !detail?.name) return;
      setActiveAgent(detail);
      setConversationId(null);
      persistActiveAgent({ data: { agentSlug: detail.slug } }).catch(() => {});
      // Zachowujemy historię — ciągła rozmowa z całym zespołem.
    }

    window.addEventListener("jarvis:agent-changed", handleAgentChanged);
    return () => window.removeEventListener("jarvis:agent-changed", handleAgentChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const history = getRecentHistory(3);
        setAgentBusy(true);
        try {
          const result = await runAgentFn({
            // Używamy aktywnego agenta zamiast hardkodowanego "orchestrator"
            data: {
              agentSlug: activeAgent.slug,
              input: text,
              history,
              conversationId: conversationId ?? undefined,
            },
          });
          reportOutcome(result.status === "done" ? "done" : "error");
          if (result.conversationId) setConversationId(result.conversationId);
          const reply =
            result.status === "done" && result.output
              ? result.output
              : `⚠ Agent error: ${result.error ?? "unknown"}`;
          emitChat("jarvis", reply, {
            agentSlug: activeAgent.slug,
            agentName: activeAgent.name,
          });
          if (result.status === "done") {
            // open_document resolved to a specific file → hand its id to the
            // Documents module and navigate there, so its preview opens. The
            // id is stashed for a fresh mount AND broadcast for an already-
            // mounted /documents (see documents.tsx). Takes precedence over a
            // plain nav action.
            if (result.openDocument) {
              requestOpenDocument(result.openDocument.id);
              performAction("open_documents", reply);
            } else {
              const action = (result.action ?? "none") as JarvisAction;
              if (action !== "none") {
                // performAction() speaks `reply` itself via fire()'s spokenLine
                // param — don't ALSO call speak(reply) below, or JARVIS would
                // narrate the same line twice.
                performAction(action, reply);
              } else {
                speak(reply);
              }
            }
          }
          qc.invalidateQueries({ queryKey: ["notes", "list"] });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          reportOutcome("error");
          emitChat("jarvis", `⚠ Agent runtime failed: ${msg}`, {
            agentSlug: activeAgent.slug,
            agentName: activeAgent.name,
          });
        } finally {
          setAgentBusy(false);
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
  const activeAgentLabel = activeAgent.name.toUpperCase();

  return (
    <div className="flex h-[420px] flex-col">
      <div className="flex items-center justify-between border-b border-primary/15 bg-gradient-to-b from-primary/[0.04] to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inset-0 animate-ping rounded-full"
              style={{ backgroundColor: "var(--success)", opacity: 0.5 }}
            />
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--success)", boxShadow: "0 0 8px var(--success)" }}
            />
          </span>
          <span className="font-display text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            ACTIVE AGENT //
          </span>
          <select
            value={activeAgent.slug}
            onChange={(e) => switchAgent(e.target.value)}
            className="font-display rounded-md border border-primary/30 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-primary backdrop-blur transition hover:border-primary/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            aria-label="Select active agent"
          >
            {(agents.length > 0
              ? agents
              : [{ slug: activeAgent.slug, name: activeAgent.name, isEnabled: true }]
            ).map((a) => (
              <option
                key={a.slug}
                value={a.slug}
                disabled={"isEnabled" in a ? !a.isEnabled : false}
              >
                {a.name.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                saveHistory([]);
                clearConversationFn({ data: { agentSlug: activeAgent.slug } }).catch(() => {
                  /* lokalny widok już wyczyszczony — serwer dogoni przy następnej sesji */
                });
              }}
              className="font-display text-[9px] uppercase tracking-[0.28em] text-muted-foreground transition hover:text-destructive"
            >
              CLEAR
            </button>
          )}
          <span className="font-display flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-0.5 text-[9px] uppercase tracking-[0.28em] text-primary/80 landscape:max-md:hidden">
            <span className="h-1 w-1 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
            SECURE // ENCRYPTED
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center opacity-70">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 animate-pulse rounded-full border border-primary/50" />
              <div className="absolute inset-2 rounded-full bg-primary/30 shadow-[0_0_16px_var(--primary)]" />
            </div>
            <p className="font-display text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
              CHANNEL CLEAR · TRANSMIT INSTRUCTION TO BEGIN
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div className={cn("max-w-[82%] space-y-1.5", m.role === "user" && "text-right")}>
              <p
                className={cn(
                  "font-display text-[9px] uppercase tracking-[0.28em]",
                  m.role === "jarvis" ? "text-primary" : "text-muted-foreground",
                )}
              >
                {/* Etykieta pochodzi z SAMEJ wiadomości, żeby po przełączeniu
                    agenta stare odpowiedzi zachowały swojego autora. */}
                {m.role === "jarvis"
                  ? `${(m.agentName ?? activeAgent.name).toUpperCase()} //`
                  : "USER //"}{" "}
                {m.time}
              </p>
              <div
                className={cn(
                  "whitespace-pre-wrap break-words rounded-xl border px-4 py-2.5 text-sm leading-relaxed backdrop-blur-sm transition-shadow",
                  m.role === "jarvis"
                    ? "border-primary/25 bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent text-foreground shadow-[0_4px_18px_-8px_color-mix(in_oklab,var(--primary)_60%,transparent),inset_0_1px_0_color-mix(in_oklab,var(--primary)_18%,transparent)]"
                    : "border-border/50 bg-secondary/30 text-foreground shadow-[inset_0_1px_0_oklch(1_0_0_/_0.04)]",
                )}
              >
                <LinkifiedText text={m.text} />
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="max-w-[82%] space-y-1.5">
              <p className="font-display text-[9px] uppercase tracking-[0.28em] text-primary">
                {activeAgentLabel} //
              </p>
              <div className="flex gap-1 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent px-4 py-3 shadow-[0_4px_18px_-8px_color-mix(in_oklab,var(--primary)_60%,transparent)]">
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
        className="flex items-center gap-2 border-t border-primary/15 bg-gradient-to-t from-primary/[0.04] to-transparent p-3.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="▸ TRANSMIT INSTRUCTION…"
          className="flex-1 rounded-lg border border-primary/25 bg-black/50 px-4 py-2.5 font-mono text-sm text-foreground backdrop-blur placeholder:text-muted-foreground/70 transition focus:border-primary focus:bg-black/70 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:shadow-[0_0_20px_-6px_var(--primary)]"
        />
        <button
          type="submit"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/50 bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_25%,transparent)] transition hover:border-primary hover:from-primary/30 hover:shadow-[var(--glow-primary)]"
          aria-label="Send"
        >
          <Send strokeWidth={1.5} className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
