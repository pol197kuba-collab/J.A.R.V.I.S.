import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { initialMessages, jarvisReplies, type ChatMessage } from "@/data/mock";
import { cn } from "@/lib/utils";

function nowTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  function send() {
    const text = input.trim();
    if (!text) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text, time: nowTime() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const reply = jarvisReplies[Math.floor(Math.random() * jarvisReplies.length)];
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "jarvis", text: reply, time: nowTime() },
      ]);
      setTyping(false);
    }, 900);
  }

  return (
    <div className="flex h-[420px] flex-col rounded-lg border border-border/60 bg-card/50 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-blink rounded-full" style={{ backgroundColor: "var(--success)" }} />
          <span className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Conversation Stream
          </span>
        </div>
        <span className="font-display text-[10px] uppercase tracking-widest text-primary/70">
          Secure // Encrypted
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
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
                {m.role === "jarvis" ? "J.A.R.V.I.S //" : "User //"} {m.time}
              </p>
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-sm leading-relaxed",
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
                J.A.R.V.I.S //
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
          placeholder="Transmit instruction…"
          className="flex-1 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/60 bg-primary/10 text-primary transition hover:bg-primary/20"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}