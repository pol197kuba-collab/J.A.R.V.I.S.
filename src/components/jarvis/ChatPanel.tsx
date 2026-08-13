import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentChatChannel } from "@/lib/ai/useAgentChatChannel";
import { LinkifiedText } from "./LinkifiedText";

export function ChatPanel() {
  const { messages, typing, activeAgent, agents, switchAgent, send, clear } = useAgentChatChannel();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void send(text);
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
              onClick={clear}
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
          handleSend();
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
