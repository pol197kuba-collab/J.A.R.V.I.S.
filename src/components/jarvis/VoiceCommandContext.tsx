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
import { speak, speakCancel } from "@/lib/audio/speak";

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
  action:
    | "dashboard"
    | "fuel"
    | "rto"
    | "jobfit"
    | "telemetry"
    | "menu_open"
    | "menu_close"
    | "system_check"
    | "sleep"
    | "shutdown";
}> = [
  // Navigation
  { re: /\b(open\s+dashboard|show\s+status|show\s+core|jarvis\s+dashboard)\b/i, action: "dashboard" },
  { re: /\b(open\s+fuel|launch\s+monitor|jarvis\s+fuel)\b/i, action: "fuel" },
  { re: /\b(open\s+calculator|launch\s+rto|jarvis\s+office)\b/i, action: "rto" },
  { re: /\b(open\s+jobfit|launch\s+ai|jarvis\s+job)\b/i, action: "jobfit" },
  { re: /\b(show\s+telemetry|open\s+map|geo[-\s]?tracking)\b/i, action: "telemetry" },
  // Interface
  { re: /\b(open\s+menu|show\s+sidebar)\b/i, action: "menu_open" },
  { re: /\b(close\s+menu|hide\s+sidebar)\b/i, action: "menu_close" },
  // Status & shutdown
  { re: /\b(system\s+check)\b/i, action: "system_check" },
  { re: /\b(jarvis\s+sleep|standby)\b/i, action: "sleep" },
  { re: /\b(disconnect|shutdown|system\s+shutdown)\b/i, action: "shutdown" },
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
  // Per-action debounce so "open menu" → "close menu" can fire back-to-back.
  const lastFireMapRef = useRef<Map<string, number>>(new Map());

  const consumePendingModule = useCallback(() => {
    const v = pendingRef.current;
    pendingRef.current = null;
    return v;
  }, []);

  const fire = useCallback(
    (action: (typeof COMMANDS)[number]["action"]) => {
      const now = Date.now();
      // Nav actions get a short window; status/shutdown stay protected.
      const window_ms =
        action === "shutdown" || action === "system_check" || action === "sleep"
          ? 2000
          : 500;
      const last = lastFireMapRef.current.get(action) ?? 0;
      if (now - last < window_ms) return;
      lastFireMapRef.current.set(action, now);
      switch (action) {
        case "dashboard":
          go("/");
          break;
        case "fuel":
          pendingRef.current = "fuel-monitor";
          speak("Loading Fuel Monitor Matrix.");
          go("/sub-systems");
          break;
        case "rto":
          pendingRef.current = "rto-calculator";
          speak("Accessing RTO calculation systems.");
          go("/sub-systems");
          break;
        case "jobfit":
          pendingRef.current = "jobfit-ai";
          speak("Initializing AI resume optimizer.");
          go("/sub-systems");
          break;
        case "telemetry":
          speak("Accessing satellite telemetry.");
          go("/geo-tracking");
          break;
        case "menu_open":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "open" }));
          break;
        case "menu_close":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "close" }));
          break;
        case "system_check":
          speak("All systems operational, Mister Slawinsky. Core temperature is nominal.");
          break;
        case "sleep":
          speak("System in standby mode.");
          setEnabled(false);
          break;
        case "shutdown":
          speak("Deactivating system. Goodbye, Mister Slawinsky.");
          setTimeout(() => speakCancel(), 3200);
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