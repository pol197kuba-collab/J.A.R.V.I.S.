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
import { askJarvis, hasGeminiKey, type JarvisAction } from "@/lib/ai/jarvisBrain";
import { emitChat, getRecentHistory } from "@/lib/ai/chatBus";

type Ctx = {
  enabled: boolean;
  supported: boolean;
  listening: boolean;
  lastTranscript: string;
  setEnabled: (v: boolean) => void;
  /** Module-init handoff for /sub-systems route */
  consumePendingModule: () => SubSystemId | null;
  /** Route arbitrary text (chat input) through the same Gemini→action pipeline. */
  routeText: (text: string) => Promise<void>;
};

const VoiceCtx = createContext<Ctx>({
  enabled: false,
  supported: false,
  listening: false,
  lastTranscript: "",
  setEnabled: () => {},
  consumePendingModule: () => null,
  routeText: async () => {},
});

export const useVoiceCommands = () => useContext(VoiceCtx);

// --- Anti-spam guards (shared between mic + chat) ---------------------------
const GEMINI_VOICE_THROTTLE_MS = 3000;
const GEMINI_CHAT_THROTTLE_MS = 1500;
// Speech debounce: how long we wait after the last final segment before
// flushing the merged buffer to Gemini. Allows "Jarvis ... open ... fuel"
// to arrive as one phrase instead of three.
const SPEECH_FLUSH_MS = 900;
// Safety flush: if interim keeps streaming but no final arrives, force-flush
// whatever we have after this much silence-from-finals.
const SPEECH_SAFETY_MS = 1500;
// Loose wake-word detector: matches the word ANYWHERE in the utterance.
// We slice off everything up to and INCLUDING the last occurrence so
// "ok jarvis open fuel" → "open fuel" and "jarvis, jarvis open fuel" →
// "open fuel" too.
// Tolerant, non-global wake-word detector. STT often returns Polish phonetic
// variants without clean word boundaries, so we drop the \b anchors and the
// `g` flag (no stateful lastIndex across calls).
const WAKE_WORD_RE = /(jarvis|jervis|dżarwis|dzarwis|żarwis|ziarwis|dziarwis|czarwis)/i;
const NOISE_RE = /^(?:e+|y+m*|u+m+|h+m+|a+h*|o+h*|m+|mhm+|hmm+)$/i;

function stripWakeWord(transcript: string): string | null {
  const cleaned = transcript.trim();
  // Find the LAST occurrence by scanning with a fresh global clone, so we
  // never mutate the shared regex's lastIndex.
  const scanner = new RegExp(WAKE_WORD_RE.source, "gi");
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(cleaned)) !== null) {
    lastEnd = m.index + m[0].length;
    if (m.index === scanner.lastIndex) scanner.lastIndex++;
  }
  if (lastEnd < 0) return null;
  // Strip leading punctuation/whitespace left after the wake word.
  return cleaned.slice(lastEnd).replace(/^[\s,.:;!?-]+/, "").trim();
}

function isNoise(command: string): boolean {
  const c = command.trim();
  if (c.length < 3) return true;
  // Strip punctuation for the noise regex check.
  const bare = c.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  if (!bare) return true;
  if (NOISE_RE.test(bare)) return true;
  return false;
}

type AnySpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        resultIndex?: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onstart: (() => void) | null;
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

type LocalAction =
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

const ACTION_MAP: Record<JarvisAction, LocalAction | null> = {
  none: null,
  open_dashboard: "dashboard",
  open_fuel: "fuel",
  open_calculator: "rto",
  open_jobfit: "jobfit",
  open_telemetry: "telemetry",
  open_menu: "menu_open",
  close_menu: "menu_close",
  system_check: "system_check",
  sleep: "sleep",
  shutdown: "shutdown",
};

const COMMANDS: Array<{ re: RegExp; action: LocalAction }> = [
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
  // Global throttle for outbound Gemini calls (mic + chat).
  const lastGeminiAtRef = useRef<number>(0);
  // Throttle queue (max 1) so a follow-up command during the 3s window isn't
  // silently dropped — it fires as soon as the window expires.
  const queuedRef = useRef<string | null>(null);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Show the "no key" system warning at most once per session.
  const offlineNoticeShownRef = useRef(false);

  const consumePendingModule = useCallback(() => {
    const v = pendingRef.current;
    pendingRef.current = null;
    return v;
  }, []);

  const fire = useCallback(
    (action: LocalAction, spokenLine?: string) => {
      const now = Date.now();
      // Nav actions get a short window; status/shutdown stay protected.
      const window_ms =
        action === "shutdown" || action === "system_check" || action === "sleep"
          ? 2000
          : 500;
      const last = lastFireMapRef.current.get(action) ?? 0;
      if (now - last < window_ms) return;
      lastFireMapRef.current.set(action, now);
      const say = (fallback: string) => speak(spokenLine && spokenLine.trim() ? spokenLine : fallback);
      switch (action) {
        case "dashboard":
          go("/");
          if (spokenLine) speak(spokenLine);
          break;
        case "fuel":
          pendingRef.current = "fuel-monitor";
          say("Loading Fuel Monitor Matrix.");
          go("/sub-systems");
          break;
        case "rto":
          pendingRef.current = "rto-calculator";
          say("Accessing RTO calculation systems.");
          go("/sub-systems");
          break;
        case "jobfit":
          pendingRef.current = "jobfit-ai";
          say("Initializing AI resume optimizer.");
          go("/sub-systems");
          break;
        case "telemetry":
          say("Accessing satellite telemetry.");
          go("/geo-tracking");
          break;
        case "menu_open":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "open" }));
          if (spokenLine) speak(spokenLine);
          break;
        case "menu_close":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "close" }));
          if (spokenLine) speak(spokenLine);
          break;
        case "system_check":
          say("All systems operational, Mister Slawinsky. Core temperature is nominal.");
          break;
        case "sleep":
          say("System in standby mode.");
          setEnabled(false);
          break;
        case "shutdown":
          say("Deactivating system. Goodbye, Mister Slawinsky.");
          setTimeout(() => speakCancel(), 3200);
          setPhase("shutdown");
          break;
      }
    },
    [go, setPhase],
  );

  /**
   * Run the transcript through Gemini for intent + spoken reply.
   * Falls back to local regex if Gemini is unavailable or returns "none"
   * but the text clearly matches a hardcoded command (best of both worlds).
   */
  const route = useCallback(
    async (transcript: string, source: "voice" | "chat" = "voice") => {
      // Global 3s throttle so back-to-back voice/chat requests don't pile up.
      const now = Date.now();
      const since = now - lastGeminiAtRef.current;
      const throttleMs =
        source === "chat" ? GEMINI_CHAT_THROTTLE_MS : GEMINI_VOICE_THROTTLE_MS;
      if (since < throttleMs) {
        // Queue at most one follow-up; dedup identical transcripts.
        if (queuedRef.current !== transcript) {
          queuedRef.current = transcript;
          console.debug("[voice] throttle: queued", transcript);
          if (queueTimerRef.current) clearTimeout(queueTimerRef.current);
          queueTimerRef.current = setTimeout(
            () => {
              const q = queuedRef.current;
              queuedRef.current = null;
              queueTimerRef.current = null;
              if (q) void route(q, source);
            },
            throttleMs - since + 50,
          );
        } else {
          console.debug("[voice] throttle: dropped duplicate", transcript);
        }
        return;
      }
      lastGeminiAtRef.current = now;
      const cleanCommand = transcript.trim();
      console.log("=== SENDING TO GEMINI VOICE CORE ===", cleanCommand);
      console.debug("[voice] → gemini", cleanCommand, `(source=${source})`);
      emitChat("user", transcript);
      if (!hasGeminiKey() && !offlineNoticeShownRef.current) {
        offlineNoticeShownRef.current = true;
        emitChat(
          "jarvis",
          "⚠ AI core offline — add Gemini key in Settings to enable natural conversation.",
        );
      }
      // Try regex first for instant response on known commands.
      const local = COMMANDS.find((c) => c.re.test(transcript));
      // Multi-turn memory: feed the last clean turns into Gemini so JARVIS
      // actually remembers what we just talked about.
      const history = getRecentHistory(10);
      // Ask Gemini for richer reply + open-ended chat handling.
      const reply = await askJarvis({
        prompt:
          source === "chat"
            ? `User typed in chat: "${transcript}"`
            : `User said via microphone: "${transcript}"`,
        source,
        history,
        fallbackKind: "generic",
      });
      console.debug("[voice] ← gemini", reply);
      if (reply.speech) emitChat("jarvis", reply.speech);
      const mapped = ACTION_MAP[reply.action];
      if (mapped) {
        fire(mapped, reply.speech);
        return;
      }
      if (local) {
        fire(local.action, reply.speech);
        return;
      }
      // Pure chit-chat — just speak.
      if (reply.speech) speak(reply.speech);
    },
    [fire],
  );

  // Microphone-only router: enforces wake word + noise filter, then delegates
  // to the shared Gemini pipeline. Chat input bypasses this and calls
  // `route()` directly via the exposed `routeText`.
  const routeFromMic = useCallback(
    async (transcript: string) => {
      const command = stripWakeWord(transcript);
      if (command === null) {
        console.debug("[voice] ignored: no wake word", transcript);
        return;
      }
      if (isNoise(command)) {
        console.debug("[voice] ignored: noise/filler", command);
        return;
      }
      await route(command, "voice");
    },
    [route],
  );

  useEffect(() => {
    console.log("[voice] effect: enabled=", enabled, "ctor=", !!Ctor);
    if (!enabled) return;
    if (!Ctor) {
      console.warn("[voice] SpeechRecognition not supported in this browser");
      return;
    }
    let stopped = false;
    const rec = new Ctor();
    recRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "pl-PL";

    // Speech debounce buffer — concatenates final segments and waits for a
    // short pause before flushing the merged phrase to Gemini.
    let speechBuffer = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
    };
    const flush = () => {
      clearTimers();
      const phrase = speechBuffer.trim();
      speechBuffer = "";
      if (!phrase) return;
      console.debug("[voice] flush", phrase);
      setLastTranscript(phrase);
      void routeFromMic(phrase);
    };

    rec.onresult = (e) => {
      console.log("RAW EVENT RECEIVED", e.results, "resultIndex=", e.resultIndex);
      const start = typeof e.resultIndex === "number" ? e.resultIndex : 0;
      let appendedFinal = false;
      let sawInterim = false;
      for (let i = start; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (!text) continue;
        if (r.isFinal) {
          console.log("[voice] final segment:", text);
          speechBuffer += (speechBuffer ? " " : "") + text;
          appendedFinal = true;
        } else {
          sawInterim = true;
        }
      }
      if (appendedFinal) {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, SPEECH_FLUSH_MS);
      }
      if ((appendedFinal || sawInterim) && speechBuffer) {
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = setTimeout(flush, SPEECH_SAFETY_MS);
      }
    };
    rec.onend = () => {
      console.log("=== STT ENGINE ENDED ===");
      setListening(false);
      // If STT closes while we still have buffered text, flush it before restart.
      if (speechBuffer) flush();
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
    rec.onstart = () => console.log("=== STT ENGINE STARTED ===");
    rec.onerror = (err) => {
      console.error("=== STT ENGINE ERROR ===", err);
      // browser may auto-stop; onend handles restart
    };
    try {
      console.log("[voice] calling rec.start()");
      rec.start();
      setListening(true);
    } catch (e) {
      console.error("[voice] rec.start() threw", e);
      /* already started */
    }
    return () => {
      stopped = true;
      clearTimers();
      speechBuffer = "";
      try {
        rec.onend = null;
        rec.onresult = null;
        rec.stop();
      } catch {}
      recRef.current = null;
      setListening(false);
    };
  }, [enabled, Ctor, routeFromMic]);

  return (
    <VoiceCtx.Provider
      value={{
        enabled,
        supported,
        listening,
        lastTranscript,
        setEnabled,
        consumePendingModule,
        routeText: (text: string) => route(text, "chat"),
      }}
    >
      {children}
    </VoiceCtx.Provider>
  );
}