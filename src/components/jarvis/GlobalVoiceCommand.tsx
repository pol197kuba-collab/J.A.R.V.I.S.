// Globalny przycisk pojedynczej komendy głosowej.
//
// Powód istnienia: mikrofon w konsoli czatu (MatrixChatConsole) wymagał
// wejścia do modułu /jarvis, żeby cokolwiek powiedzieć. Ten przycisk robi
// DOKŁADNIE to samo — jedno przechwycenie, pełny agent ze wszystkimi
// narzędziami — tylko z dowolnej strony aplikacji.
//
// LENIWE MONTOWANIE HOOKA CZATU, i to jest tu najważniejsza decyzja.
// useAgentChatChannel odpytuje listę agentów co 15 sekund. Ten przycisk
// wisi na każdej stronie, więc trzymanie hooka na stałe dołożyłoby ten
// polling wszędzie — także komuś, kto przez godzinę ogląda wykresy i nie
// tknie mikrofonu. Dlatego hook żyje w osobnym komponencie (VoiceSendRunner),
// montowanym dopiero wtedy, gdy jest co wysłać, i odmontowywanym po
// odpowiedzi. Sam przycisk używa wyłącznie rzeczy darmowych: rozpoznawania
// mowy i kontekstu komend głosowych.
//
// Odpowiedź łapiemy z magistrali czatu (onChat), a nie ze stanu hooka —
// dzięki temu runner może zniknąć, a karta i tak pokaże wynik. Odmontowanie
// runnera nie przerywa trwającego żądania: send() leci do końca, a jego
// odpowiedź i tak trafia do historii czatu.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Mic, MicOff, MessageSquare, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { audio } from "@/lib/audio/AudioEngine";
import { onChat } from "@/lib/ai/chatBus";
import { useAgentChatChannel } from "@/lib/ai/useAgentChatChannel";
import { useSingleVoiceCommand } from "./useSingleVoiceCommand";
import { useVoiceCommands } from "./VoiceCommandContext";

type Phase = "idle" | "listening" | "thinking" | "reply" | "nothing-heard";

/** Jak długo karta zostaje na ekranie po odpowiedzi. */
const DISMISS_AFTER_MS = 12_000;
/** Krócej, gdy nie ma czego czytać. */
const DISMISS_SHORT_MS = 4_000;

/**
 * Montowany tylko na czas jednej komendy: mount = wyślij, i tyle.
 * Nic nie renderuje — istnieje wyłącznie po to, żeby cykl życia hooka
 * czatu (z jego pollingiem) trwał tyle, co samo wywołanie.
 */
function VoiceSendRunner({ text, onSent }: { text: string; onSent: () => void }) {
  const { send } = useAgentChatChannel();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void send(text).finally(onSent);
  }, [send, text, onSent]);

  return null;
}

export function GlobalVoiceCommand() {
  const navigate = useNavigate();
  const { supported, listening: capturing, capture } = useSingleVoiceCommand();
  const { enabled: continuousEnabled, setEnabled: setContinuous } = useVoiceCommands();

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const dismissRef = useRef<number | null>(null);

  const clearDismiss = useCallback(() => {
    if (dismissRef.current !== null) {
      window.clearTimeout(dismissRef.current);
      dismissRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(
    (ms: number) => {
      clearDismiss();
      dismissRef.current = window.setTimeout(() => {
        setPhase("idle");
        dismissRef.current = null;
      }, ms);
    },
    [clearDismiss],
  );

  useEffect(() => clearDismiss, [clearDismiss]);

  // Odpowiedź z magistrali czatu. Nasłuchujemy tylko w trakcie oczekiwania,
  // żeby karta nie zapalała się od wiadomości wywołanych gdzie indziej
  // (np. z konsoli czatu otwartej w module JARVIS).
  useEffect(() => {
    if (phase !== "thinking") return;
    return onChat((msg) => {
      if (msg.role !== "jarvis") return;
      setReply(msg.text);
      setPhase("reply");
      scheduleDismiss(DISMISS_AFTER_MS);
    });
  }, [phase, scheduleDismiss]);

  const start = useCallback(async () => {
    if (!supported || capturing || phase === "thinking") return;
    clearDismiss();
    audio.playBeep(1200, 0.1, 0.22);

    // Nasłuch ciągły i to przechwycenie to dwie sesje SpeechRecognition
    // walczące o mikrofon — ten sam konflikt rozwiązuje mikrofon w konsoli
    // czatu i rozwiązujemy go tak samo.
    if (continuousEnabled) setContinuous(false);

    setTranscript("");
    setReply("");
    setPhase("listening");

    const heard = await capture();
    if (!heard) {
      setPhase("nothing-heard");
      scheduleDismiss(DISMISS_SHORT_MS);
      return;
    }

    setTranscript(heard);
    setPhase("thinking");
    setPending(heard);
  }, [
    supported,
    capturing,
    phase,
    clearDismiss,
    continuousEnabled,
    setContinuous,
    capture,
    scheduleDismiss,
  ]);

  const openFullChat = () => {
    clearDismiss();
    setPhase("idle");
    void navigate({ to: "/jarvis" });
  };

  const cardVisible = phase !== "idle";
  const busy = phase === "listening" || phase === "thinking";

  return (
    <div className="pointer-events-none relative flex flex-col items-end">
      {/* Karta jest ABSOLUTNA, nie kolejnym elementem kolumny. Przycisk
          mieszka teraz w pasku dolnym, czyli w rzędzie o ustalonej
          wysokości — karta w normalnym przepływie rozpychałaby ten rząd
          przy każdej odpowiedzi. `bottom-full` kotwiczy ją nad przyciskiem
          niezależnie od tego, gdzie ten przycisk wisi. */}
      {cardVisible && (
        <div
          role="status"
          aria-live="polite"
          className="hud-panel pointer-events-auto absolute right-0 bottom-full z-50 mb-2 w-[min(340px,calc(100vw-2rem))] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              {phase === "listening"
                ? "Słucham…"
                : phase === "thinking"
                  ? "J.A.R.V.I.S. myśli…"
                  : phase === "nothing-heard"
                    ? "Nie usłyszałem"
                    : "Odpowiedź"}
            </p>
            <button
              type="button"
              aria-label="Zamknij"
              onClick={() => {
                clearDismiss();
                setPhase("idle");
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-primary/20 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {transcript && (
            <p className="mt-1.5 min-w-0 break-words font-mono text-[11px] leading-snug text-primary/90">
              „{transcript}"
            </p>
          )}

          {phase === "thinking" && (
            <div className="mt-2 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="font-mono text-[10px] text-muted-foreground">
                pracuje nad odpowiedzią
              </span>
            </div>
          )}

          {phase === "nothing-heard" && (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Mikrofon nic nie zarejestrował. Spróbuj ponownie, mówiąc zaraz po sygnale.
            </p>
          )}

          {phase === "reply" && reply && (
            <>
              {/* Długa odpowiedź musi dać się przewinąć, ale bez systemowego
                  paska — konwencja całej aplikacji (no-scrollbar). */}
              <p className="no-scrollbar mt-2 max-h-40 min-w-0 overflow-x-hidden overflow-y-auto break-words text-xs leading-relaxed text-foreground">
                {reply}
              </p>
              <button
                type="button"
                onClick={openFullChat}
                className="font-display mt-2 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-primary transition hover:text-foreground"
              >
                <MessageSquare className="h-3 w-3" />
                Otwórz pełny czat
              </button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void start()}
        disabled={!supported || busy}
        aria-label={
          !supported
            ? "Rozpoznawanie mowy niedostępne w tej przeglądarce"
            : phase === "listening"
              ? "Słucham…"
              : "Powiedz komendę"
        }
        className={cn(
          "pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all",
          "border-primary/60 bg-card/90 text-primary shadow-[var(--glow-primary)] backdrop-blur",
          "hover:scale-105 hover:bg-primary/10 active:scale-95",
          "disabled:opacity-60 disabled:hover:scale-100",
          phase === "listening" && "border-primary bg-primary/20",
        )}
      >
        {phase === "listening" && (
          <>
            <span className="animate-ripple absolute inset-0 rounded-full border-2 border-primary/60" />
            <span className="animate-ripple absolute inset-0 rounded-full border-2 border-primary/40 [animation-delay:0.4s]" />
          </>
        )}
        {!supported ? (
          <MicOff strokeWidth={1.5} className="h-6 w-6" />
        ) : phase === "thinking" ? (
          <Loader2 strokeWidth={1.5} className="h-6 w-6 animate-spin" />
        ) : (
          <Mic strokeWidth={1.5} className="h-6 w-6" />
        )}
      </button>

      {pending !== null && (
        <VoiceSendRunner
          text={pending}
          onSent={() => {
            setPending(null);
            // Gdyby agent nie wyemitował nic na magistralę (błąd sieci,
            // pusty wynik), karta nie może wisieć w „myśli…" w nieskończoność.
            setPhase((p) => {
              if (p !== "thinking") return p;
              scheduleDismiss(DISMISS_SHORT_MS);
              return "nothing-heard";
            });
          }}
        />
      )}
    </div>
  );
}
