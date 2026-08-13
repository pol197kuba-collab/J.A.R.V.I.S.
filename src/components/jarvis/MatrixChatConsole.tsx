import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, SendHorizonal, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentChatChannel } from "@/lib/ai/useAgentChatChannel";
import { useVoiceCommands } from "./VoiceCommandContext";
import { useSingleVoiceCommand } from "./useSingleVoiceCommand";

// Transmission-log styled chat console for the /jarvis matrix view.
// Deliberately different from the Dashboard ChatPanel (bubbles): here every
// line is a channel transmission with a gutter timestamp, a callsign and a
// left signal rail — same tokens (cyan HUD, font-display/font-mono, panel
// chrome) as HudOverlay / "Recent Network Assignments". The actual send/
// receive/error-handling logic is NOT reimplemented here — both this console
// and the Dashboard ChatPanel share useAgentChatChannel() so they talk to
// the exact same orchestrator/backend.

function nowStamp() {
  return new Date().toTimeString().slice(0, 8);
}

export function MatrixChatConsole() {
  const { messages, typing, activeAgent, send } = useAgentChatChannel();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Continuous wake-word listening (global toggle) is a DIFFERENT mode from
  // this console's mic button, which captures exactly one command. Pausing
  // it before a capture avoids two SpeechRecognition sessions fighting over
  // the same microphone.
  const { enabled: continuousListeningEnabled, setEnabled: setContinuousListening } =
    useVoiceCommands();
  const { listening: capturing, supported: micSupported, capture } = useSingleVoiceCommand();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void send(text);
  }

  async function handleMicClick() {
    if (capturing) return;
    if (continuousListeningEnabled) setContinuousListening(false);
    const transcript = await capture();
    if (transcript) void send(transcript);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Channel header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.07] to-transparent px-4 py-2">
        <div className="flex items-center gap-2">
          <Radio className="h-3 w-3 text-cyan-300" strokeWidth={1.5} />
          <span className="font-display text-[9px] uppercase tracking-[0.28em] text-cyan-300/90 [text-shadow:0_0_12px_rgba(77,216,255,0.5)]">
            Direct Channel // {activeAgent.name.toUpperCase()}
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-[8px] uppercase tracking-[0.2em]",
            typing ? "text-cyan-200" : "text-white/35",
          )}
        >
          {typing ? "link · active" : "link · idle"}
        </span>
      </div>

      {/* Transmission log */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !typing ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
            ▸ kanał otwarty — nadaj komendę…
          </p>
        ) : null}

        {messages.map((m) => {
          const jarvis = m.role === "jarvis";
          return (
            <div
              key={m.id}
              className={cn(
                "grid grid-cols-[52px_1fr] gap-2 border-l-2 pl-2",
                jarvis ? "border-cyan-400/70" : "border-white/25",
              )}
            >
              <span className="pt-[3px] font-mono text-[8px] leading-none text-white/35">
                {m.time || nowStamp()}
              </span>
              <div>
                <p
                  className={cn(
                    "font-display text-[8px] uppercase tracking-[0.28em]",
                    jarvis ? "text-cyan-300/90" : "text-white/45",
                  )}
                >
                  {jarvis ? (m.agentName ?? "J.A.R.V.I.S.").toUpperCase() : "OPERATOR"}
                </p>
                <p
                  className={cn(
                    "mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug",
                    jarvis ? "text-cyan-50/90" : "text-white/70",
                  )}
                >
                  {m.text}
                </p>
              </div>
            </div>
          );
        })}

        {/* HUD processing indicator — scanning bar, not a spinner */}
        {typing ? (
          <div className="grid grid-cols-[52px_1fr] gap-2 border-l-2 border-cyan-400/70 pl-2">
            <span className="pt-[3px] font-mono text-[8px] leading-none text-white/35">
              {nowStamp()}
            </span>
            <div>
              <p className="font-display text-[8px] uppercase tracking-[0.28em] text-cyan-300/90">
                decrypting response
              </p>
              <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-cyan-400/10">
                <div className="h-full w-1/3 animate-[hud-scan_1.4s_ease-in-out_infinite] rounded-full bg-cyan-300/80 shadow-[0_0_10px_rgba(77,216,255,0.8)]" />
              </div>
              <div className="mt-1 flex gap-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="h-2 w-[3px] origin-bottom bg-cyan-300/60"
                    style={{
                      animation: `wave-bar ${0.5 + (i % 4) * 0.12}s ease-in-out ${i * 0.05}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Command bar */}
      <div className="shrink-0 border-t border-cyan-400/20 bg-black/40 px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-md border border-cyan-400/25 bg-black/50 px-2 py-1.5 shadow-[0_0_24px_-12px_rgba(77,216,255,0.7)] focus-within:border-cyan-300/60">
          <span className="font-mono text-[11px] text-cyan-300/70">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="wpisz komendę dla J.A.R.V.I.S.…"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-cyan-50 placeholder:text-white/25 focus:outline-none"
          />
          <button
            type="button"
            disabled={!micSupported}
            onClick={handleMicClick}
            aria-label="Pojedyncza komenda głosowa"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
              capturing
                ? "border-cyan-300 bg-cyan-400/20 text-cyan-200 shadow-[0_0_14px_rgba(77,216,255,0.6)]"
                : "border-cyan-400/25 text-cyan-300/70 hover:bg-cyan-400/10",
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
            onClick={handleSend}
            aria-label="Wyślij"
            className="flex h-7 items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-400/15 px-2.5 font-display text-[8px] uppercase tracking-[0.22em] text-cyan-200 transition-colors hover:bg-cyan-400/25"
          >
            <SendHorizonal className="h-3 w-3" strokeWidth={1.5} />
            send
          </button>
        </div>
      </div>
    </div>
  );
}
