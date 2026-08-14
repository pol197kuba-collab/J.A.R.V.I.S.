import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { emitChat, getRecentHistory, onChat, HISTORY_KEY, type ChatBusMessage } from "./chatBus";
import type { JarvisAction } from "./jarvisBrain";
import { useVoiceCommands } from "@/components/jarvis/VoiceCommandContext";
import {
  listAgents,
  runAgent,
  getActiveConversation,
  clearConversation,
  setActiveAgent as setActiveAgentFn,
  getActiveAgentSlug,
  type AgentSummary,
} from "@/lib/agents/runtime.functions";
import { speak } from "@/lib/audio/speak";
import { setAgentBusy, reportOutcome } from "./agentActivity";
import { requestOpenDocument } from "@/lib/documents/openDocumentBus";
import { enrichDocumentImagesFn } from "@/lib/documents/generated.functions";
import { runDocumentJobFn } from "@/lib/agents/documentJobs.functions";
import { ACTIVE_AGENT_LS_KEY } from "@/routes/agent-hub";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";

// Single source of truth for "send a message to an agent and handle the
// reply" — extracted out of the Dashboard ChatPanel so the /jarvis matrix
// console (MatrixChatConsole) can talk to the exact same backend/orchestrator
// without re-implementing conversation sync, active-agent tracking, UI-action
// dispatch, or error handling. Consumers differ only in how they RENDER
// `messages`/`typing`/`activeAgent` — never in how a message actually gets
// sent or a reply gets applied.

const MAX_HISTORY = 60;
const SERVER_KEY_LINKED_LS_KEY = "jarvis_server_gemini_linked";

const DEFAULT_AGENT: ActiveAgent = { slug: AGENT_SLUGS.JARVIS, name: "J.A.R.V.I.S." };

export type ActiveAgent = { slug: string; name: string };

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
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatBusMessage[];
  } catch {
    return [];
  }
}

function saveHistory(items: ChatBusMessage[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

export type AgentChatChannel = {
  messages: ChatBusMessage[];
  typing: boolean;
  activeAgent: ActiveAgent;
  agents: AgentSummary[];
  /** Switch the account-wide active agent (persists + syncs across devices). */
  switchAgent: (slug: string) => void;
  /** Send `text` to the active agent and apply its reply (or error) to the
   *  shared chat bus — the exact same server-routed / local-fallback path
   *  ChatPanel has always used. */
  send: (text: string) => Promise<void>;
  /** Clear the local transcript and the active agent's server-side thread. */
  clear: () => void;
};

export function useAgentChatChannel(): AgentChatChannel {
  const [messages, setMessages] = useState<ChatBusMessage[]>(() => loadHistory());
  const [typing, setTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<ActiveAgent>(() => readActiveAgent());
  const noticeShownRef = useRef(false);

  const { routeText, performAction } = useVoiceCommands();
  const qc = useQueryClient();
  const runAgentFn = useServerFn(runAgent);
  const fetchAgents = useServerFn(listAgents);
  const fetchConversation = useServerFn(getActiveConversation);
  const clearConversationFn = useServerFn(clearConversation);
  const persistActiveAgent = useServerFn(setActiveAgentFn);
  const fetchActiveAgentSlug = useServerFn(getActiveAgentSlug);
  const enrichImages = useServerFn(enrichDocumentImagesFn);
  const runDocumentJob = useServerFn(runDocumentJobFn);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 15000,
  });

  const switchAgent = useCallback(
    (slug: string) => {
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
    },
    [agents, persistActiveAgent],
  );

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
  }, [activeAgent.slug, fetchConversation]);

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

  // Subscribe to the global chat bus — the SAME transcript every mounted
  // chat surface (Dashboard ChatPanel, /jarvis MatrixChatConsole) renders.
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

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      setTyping(true);
      try {
        if (hasServerKey()) {
          emitChat("user", text);
          const history = getRecentHistory(3);
          setAgentBusy(true);
          try {
            const result = await runAgentFn({
              // Używamy aktywnego agenta zamiast hardkodowanego "jarvis"
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
            // Background graphics: the file is already delivered text-only;
            // kick the enrichment pass in its own request and don't await it
            // (it can take 20-40s during a 503 storm). The /documents panel
            // reflects progress via image_status. Fire-and-forget by design.
            if (result.enrichDocument) {
              enrichImages({ data: { fileId: result.enrichDocument.id } }).catch(() => {
                /* best-effort — the file exists text-only regardless */
              });
            }
            // Real background pipeline: queue_document_job only enqueued a
            // row — kick the actual Insight → Forge run in its own request,
            // same fire-and-forget idiom as image enrichment above. It can
            // take minutes; completion arrives later as a notification, not
            // in this response, so nothing here awaits it.
            if (result.documentJob) {
              runDocumentJob({ data: { jobId: result.documentJob.id } }).catch(() => {
                /* best-effort — a failure still lands a notification server-side */
              });
            }
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
    },
    [
      activeAgent.slug,
      activeAgent.name,
      conversationId,
      runAgentFn,
      enrichImages,
      performAction,
      routeText,
      qc,
    ],
  );

  const clear = useCallback(() => {
    setMessages([]);
    saveHistory([]);
    clearConversationFn({ data: { agentSlug: activeAgent.slug } }).catch(() => {
      /* lokalny widok już wyczyszczony — serwer dogoni przy następnej sesji */
    });
  }, [activeAgent.slug, clearConversationFn]);

  return { messages, typing, activeAgent, agents, switchAgent, send, clear };
}
