import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHudNavigate } from "./TransitionContext";
import { usePhase } from "./PhaseContext";
import type { SubSystemId } from "@/data/subSystems";

type Ctx = {
  enabled: boolean;
  supported: boolean;
  listening: boolean;
  lastTranscript: string;
  setEnabled: (v: boolean) => void;
  /** Module-init handoff for /sub-systems route */
  consumePendingModule: () => SubSystemId | null;
};

const VoiceCtx = createContext<Ctx>({
  enabled: false,
  supported: false,
  listening: false,
  lastTranscript: "",
  setEnabled: () => {},
  consumePendingModule: () => null,
});

export const useVoiceCommands = () => useContext(VoiceCtx);

type AnySpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechCtor():
  | (new () => AnySpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => AnySpeechRecognition;
    webkitSpeechRecognition?: new () => AnySpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const COMMANDS: Array<{
  re: RegExp;
  action: "dashboard" | "fuel" | "rto" | "jobfit" | "shutdown";
}> = [
  { re: /\b(jarvis\s+dashboard|show\s+core)\b/i, action: "dashboard" },
  { re: /\b(jarvis\s+fuel|open\s+fuel)\b/i, action: "fuel" },
  { re: /\b(jarvis\s+office|open\s+calculator)\b/i, action: "rto" },
  { re: /\b(jarvis\s+job|open\s+jobfit)\b/i, action: "jobfit" },
  { re: /\b(jarvis\s+system\s+shutdown|disconnect)\b/i, action: "shutdown" },
];

export function VoiceCommandProvider({ children }: { children: ReactNode }) {
  const { go } = useHudNavigate();
  const { setPhase } = usePhase();
  const Ctor = getSpeechCtor();
  const supported = !!Ctor;
  const [enabled, setEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const pendingRef = useRef<SubSystemId | null>(null);
  const recRef = useRef<AnySpeechRecognition | null>(null);
  const lastFireRef = useRef(0);

  const consumePendingModule = useCallback(() => {
    const v = pendingRef.current;
    pendingRef.current = null;
    return v;
  }, []);

  const fire = useCallback(
    (action: (typeof COMMANDS)[number]["action"]) => {
      const now = Date.now();
      if (now - lastFireRef.current < 1500) return; // debounce
      lastFireRef.current = now;
      switch (action) {
        case "dashboard":
          go("/");
          break;
        case "fuel":
          pendingRef.current = "fuel-monitor";
          go("/sub-systems");
          break;
        case "rto":
          pendingRef.current = "rto-calculator";
          go("/sub-systems");
          break;
        case "jobfit":
          pendingRef.current = "jobfit-ai";
          go("/sub-systems");
          break;
        case "shutdown":
          setPhase("shutdown");
          break;
      }
    },
    [go, setPhase],
  );

  useEffect(() => {
    if (!enabled || !Ctor) return;
    let stopped = false;
    const rec = new Ctor();
    recRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
      }
      if (!finalText) return;
      const t = finalText.trim();
      setLastTranscript(t);
      for (const c of COMMANDS) {
        if (c.re.test(t)) {
          fire(c.action);
          break;
        }
      }
    };
    rec.onend = () => {
      setListening(false);
      if (!stopped) {
        // auto-restart for continuous listen
        try {
          rec.start();
          setListening(true);
        } catch {
          /* ignore — will retry on next toggle */
        }
      }
    };
    rec.onerror = () => {
      // browser may auto-stop; onend handles restart
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
    }
    return () => {
      stopped = true;
      try {
        rec.onend = null;
        rec.onresult = null;
        rec.stop();
      } catch {}
      recRef.current = null;
      setListening(false);
    };
  }, [enabled, Ctor, fire]);

  return (
    <VoiceCtx.Provider
      value={{
        enabled,
        supported,
        listening,
        lastTranscript,
        setEnabled,
        consumePendingModule,
      }}
    >
      {children}
    </VoiceCtx.Provider>
  );
}