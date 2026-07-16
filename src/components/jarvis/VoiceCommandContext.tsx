import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHudNavigate } from "./TransitionContext";
import { usePhase } from "./PhaseContext";
import type { SubSystemId } from "@/data/subSystems";
import { useServerFn } from "@tanstack/react-start";
import { speak, speakCancel, onSpeaking, isSpeakingNow } from "@/lib/audio/speak";
import { askJarvis, hasGeminiKey, type JarvisAction } from "@/lib/ai/jarvisBrain";
import { emitChat, getRecentHistory } from "@/lib/ai/chatBus";
import { matchesReboot } from "@/lib/ai/rebootPhrases";
import { getUserSettings } from "@/lib/agents/runtime.functions";

type Ctx = {
  enabled: boolean;
  supported: boolean;
  listening: boolean;
  /** Follow-up window is open — mic input is routed WITHOUT the wake word. */
  inConversation: boolean;
  lastTranscript: string;
  setEnabled: (v: boolean) => void;
  /** Module-init handoff for /sub-systems route */
  consumePendingModule: () => SubSystemId | null;
  /** Route arbitrary text (chat input) through the same Gemini→action pipeline. */
  routeText: (text: string) => Promise<void>;
  /**
   * Execute a JarvisAction directly, without going through Gemini again.
   * Used by ChatPanel when the server-routed orchestrator already resolved
   * an action server-side — avoids a second, redundant classification pass
   * and reuses the exact same navigation logic voice commands use.
   */
  performAction: (action: JarvisAction, spokenLine?: string) => void;
};

const VoiceCtx = createContext<Ctx>({
  enabled: false,
  supported: false,
  listening: false,
  inConversation: false,
  lastTranscript: "",
  setEnabled: () => {},
  consumePendingModule: () => null,
  routeText: async () => {},
  performAction: () => {},
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
// Conversation mode: after JARVIS finishes speaking a reply (and after each
// accepted mic utterance), a follow-up window opens during which speech is
// routed WITHOUT the wake word — like Alexa/Google Home follow-up mode.
const CONVERSATION_WINDOW_MS = 20_000;
// Echo guard: transcripts arriving while TTS is speaking (or within this
// grace period after it stops) are the browser hearing JARVIS's own voice —
// drop them, or conversation mode would make him answer himself.
const ECHO_GRACE_MS = 600;
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
  | "shutdown"
  | "reboot"
  | "agents"
  | "settings"
  | "logs"
  | "tasks"
  | "subsystems"
  | "vision_scan";

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
  reboot: "reboot",
  open_agents: "agents",
  open_settings: "settings",
  open_logs: "logs",
  open_tasks: "tasks",
  open_subsystems: "subsystems",
  vision_scan: "vision_scan",
};

const COMMANDS: Array<{ re: RegExp; action: LocalAction }> = [
  // Navigation
  { re: /\b(open\s+dashboard|show\s+status|show\s+core|jarvis\s+dashboard|otwórz\s+pulpit|otworz\s+pulpit|pokaż\s+dashboard|pokaz\s+dashboard|wróć\s+do\s+dashboardu|wroc\s+do\s+dashboardu)\b/i, action: "dashboard" },
  { re: /\b(open\s+fuel|launch\s+monitor|jarvis\s+fuel|otwórz\s+paliwo|otworz\s+paliwo|monitor\s+paliwa)\b/i, action: "fuel" },
  { re: /\b(open\s+calculator|launch\s+rto|jarvis\s+office|otwórz\s+kalkulator|otworz\s+kalkulator|kalkulator\s+rto)\b/i, action: "rto" },
  { re: /\b(open\s+jobfit|launch\s+ai|jarvis\s+job|otwórz\s+jobfit|otworz\s+jobfit)\b/i, action: "jobfit" },
  { re: /\b(show\s+telemetry|open\s+map|geo[-\s]?tracking|otwórz\s+mapę|otworz\s+mape|pokaż\s+mapę|pokaz\s+mape|geolokalizacja)\b/i, action: "telemetry" },
  { re: /\b(open\s+agents?|agent\s+hub|otwórz\s+agentów|otworz\s+agentow|pokaż\s+agentów|pokaz\s+agentow)\b/i, action: "agents" },
  { re: /\b(open\s+settings|otwórz\s+ustawienia|otworz\s+ustawienia|pokaż\s+ustawienia|pokaz\s+ustawienia|konfiguracja)\b/i, action: "settings" },
  { re: /\b(open\s+logs|system\s+logs|otwórz\s+logi|otworz\s+logi|pokaż\s+logi|pokaz\s+logi|dziennik\s+systemu)\b/i, action: "logs" },
  { re: /\b(open\s+tasks?|task\s+queue|otwórz\s+zadania|otworz\s+zadania|pokaż\s+zadania|pokaz\s+zadania|moje\s+zadania|lista\s+zadań|lista\s+zadan)\b/i, action: "tasks" },
  { re: /\b(open\s+sub[-\s]?systems|otwórz\s+podsystemy|otworz\s+podsystemy|pokaż\s+podsystemy|pokaz\s+podsystemy)\b/i, action: "subsystems" },
  { re: /\b(co\s+widzisz|powiedz\s+co\s+widzisz|zeskanuj\s+otoczenie|przeskanuj\s+otoczenie|skanuj\s+otoczenie|zeskanuj\s+to|what\s+do\s+you\s+see|scan\s+(?:the\s+)?(?:room|area|surroundings)|vision\s+scan)\b/i, action: "vision_scan" },
  // Interface
  { re: /\b(open\s+menu|show\s+sidebar|otwórz\s+menu|otworz\s+menu|pokaż\s+menu|pokaz\s+menu)\b/i, action: "menu_open" },
  { re: /\b(close\s+menu|hide\s+sidebar|zamknij\s+menu|schowaj\s+menu|ukryj\s+menu)\b/i, action: "menu_close" },
  // Status & shutdown
  { re: /\b(system\s+check|sprawdź\s+system|sprawdz\s+system|status\s+systemu|raport\s+systemu)\b/i, action: "system_check" },
  { re: /\b(jarvis\s+sleep|standby|uśpij|uspij|tryb\s+czuwania|stan\s+czuwania)\b/i, action: "sleep" },
  { re: /\b(disconnect|shutdown|system\s+shutdown|wyłącz\s+system|wylacz\s+system|zamknij\s+system|rozłącz|rozlacz)\b/i, action: "shutdown" },
  { re: /\b(reboot|restart|reset|zrestartuj|zresetuj|ark\s+reboot|zrestartuj\s+system|uruchom\s+ponownie)\b/i, action: "reboot" },
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

  // --- Conversation mode state -------------------------------------------
  const [inConversation, setInConversation] = useState(false);
  // Epoch ms until which mic input is accepted without the wake word.
  const conversationUntilRef = useRef(0);
  const conversationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Echo guard — mirrors speak.ts state into refs usable inside rec.onresult.
  const speakingRef = useRef(isSpeakingNow());
  const lastSpeakEndRef = useRef(0);
  // Wake-word requirement from user_settings (Settings → Voice). Kept in a
  // ref because routeFromMic lives inside the recognition effect's closure.
  const wakeWordEnabledRef = useRef(true);
  const fetchSettings = useServerFn(getUserSettings);
  // `enabled` mirrored into a ref so the onSpeaking subscription (mounted
  // once) can check mic state without resubscribing on every toggle.
  const enabledRef = useRef(false);

  const openConversationWindow = useCallback(() => {
    if (!enabledRef.current) return; // mic disarmed — window is meaningless
    conversationUntilRef.current = Date.now() + CONVERSATION_WINDOW_MS;
    setInConversation(true);
    if (conversationTimerRef.current) clearTimeout(conversationTimerRef.current);
    conversationTimerRef.current = setTimeout(() => {
      // The window may have been extended since this timer was armed.
      if (Date.now() >= conversationUntilRef.current) setInConversation(false);
    }, CONVERSATION_WINDOW_MS + 50);
  }, []);

  const consumePendingModule = useCallback(() => {
    const v = pendingRef.current;
    pendingRef.current = null;
    return v;
  }, []);

  // The throttle-queue timer (set inside `route`) outlives any single mic
  // session — it must still be cleared on provider unmount, or a queued
  // command can fire `route()` against an unmounted tree.
  useEffect(() => {
    return () => {
      if (queueTimerRef.current) {
        clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
      if (conversationTimerRef.current) {
        clearTimeout(conversationTimerRef.current);
        conversationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      // Disarming the mic closes the conversation window immediately.
      conversationUntilRef.current = 0;
      setInConversation(false);
    }
  }, [enabled]);

  // Track TTS state for the echo guard, and open the follow-up window the
  // moment JARVIS finishes speaking a reply — this covers BOTH reply paths
  // (voice route() and ChatPanel's server runAgent), since both end in
  // speak().
  useEffect(() => {
    return onSpeaking((speaking) => {
      const was = speakingRef.current;
      speakingRef.current = speaking;
      if (was && !speaking) {
        lastSpeakEndRef.current = Date.now();
        openConversationWindow();
      }
    });
  }, [openConversationWindow]);

  // Wake-word requirement: read once on mount and re-read when Settings
  // broadcasts a change (see settings.tsx updatePref). Fail-open to `true`
  // (current behaviour) when settings can't be loaded (e.g. not signed in).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await fetchSettings();
        if (!cancelled) wakeWordEnabledRef.current = s.wakeWordEnabled ?? true;
      } catch {
        /* keep current value */
      }
    };
    void load();
    const onPrefs = () => void load();
    window.addEventListener("jarvis:prefs-updated", onPrefs);
    return () => {
      cancelled = true;
      window.removeEventListener("jarvis:prefs-updated", onPrefs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fire = useCallback(
    (action: LocalAction, spokenLine?: string) => {
      const now = Date.now();
      // Nav actions get a short window; status/shutdown stay protected.
      const window_ms =
        action === "shutdown" ||
        action === "system_check" ||
        action === "sleep" ||
        action === "vision_scan"
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
          say("Ładuję Fuel Monitor Matrix.");
          go("/sub-systems");
          break;
        case "rto":
          pendingRef.current = "rto-calculator";
          say("Uruchamiam kalkulator RTO.");
          go("/sub-systems");
          break;
        case "jobfit":
          pendingRef.current = "jobfit-ai";
          say("Uruchamiam optymalizator CV.");
          go("/sub-systems");
          break;
        case "telemetry":
          say("Uruchamiam telemetrię satelitarną.");
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
      case "agents":
        say("Przechodzę do Agent Hub, sir.");
        go("/agent-hub");
        break;
      case "settings":
        say("Otwieram konfigurację.");
        go("/settings");
        break;
      case "logs":
        say("Otwieram dziennik systemu.");
        go("/system-logs");
        break;
      case "tasks":
        say("Otwieram kolejkę zadań, sir.");
        go("/tasks");
        break;
      case "subsystems":
        say("Otwieram podsystemy.");
        go("/sub-systems");
        break;
        case "system_check":
          say("Wszystkie systemy sprawne, Panie Sławiński. Temperatura rdzenia nominalna.");
          break;
        case "sleep":
          say("Tryb czuwania aktywny.");
          setEnabled(false);
          break;
        case "shutdown":
          say("Wyłączam system. Do zobaczenia, Panie Sławiński.");
          setTimeout(() => speakCancel(), 3200);
          setPhase("shutdown");
          break;
        case "reboot":
          // Bridge to ArkRebootProvider (mounted below this provider).
          window.dispatchEvent(new CustomEvent("jarvis:reboot"));
          if (spokenLine) speak(spokenLine);
          break;
        case "vision_scan":
          // Bridge to VisionScanner: the sessionStorage flag survives the
          // route transition when we're elsewhere, the event covers the
          // already-on-/vision case (go() no-ops on same path).
          say("Analizuję obraz z czujników optycznych.");
          try {
            window.sessionStorage.setItem("jarvis_pending_scan", "1");
          } catch {
            /* ignore */
          }
          window.dispatchEvent(new CustomEvent("jarvis:vision-scan"));
          go("/vision");
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
      // Local safety-net: reboot phrases short-circuit Gemini entirely so
      // the cinematic sequence fires instantly and we never hit 429.
      if (matchesReboot(transcript)) {
        emitChat("user", transcript);
        const line = "Przyjąłem. Uruchamiam Protokół Ark Reboot.";
        emitChat("jarvis", line);
        speak(line);
        window.dispatchEvent(new CustomEvent("jarvis:reboot"));
        return;
      }
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
          "⚠ Rdzeń AI offline — dodaj klucz Gemini w Ustawieniach, aby włączyć rozmowę.",
        );
      }
      // Try regex first for instant response on known commands.
      const local = COMMANDS.find((c) => c.re.test(transcript));
            if (local) {
        fire(local.action);
        return;
      }
      // Multi-turn memory: feed the last clean turns into Gemini so JARVIS
      // actually remembers what we just talked about.
      const history = getRecentHistory(3);
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
      // Pure chit-chat — just speak.
      if (reply.speech) speak(reply.speech);
    },
    [fire],
  );

  // Microphone-only router. The wake word is required only to START an
  // interaction; once JARVIS replies, a follow-up conversation window keeps
  // routing wake-word-less speech (extended by each accepted utterance).
  // With the Settings wake-word toggle OFF, speech is always routed. Noise
  // filtering applies on every path. Chat input bypasses this entirely and
  // calls `route()` directly via the exposed `routeText`.
  const routeFromMic = useCallback(
    async (transcript: string) => {
      const command = stripWakeWord(transcript);
      if (command !== null) {
        if (isNoise(command)) {
          console.debug("[voice] ignored: noise/filler", command);
          return;
        }
        openConversationWindow();
        await route(command, "voice");
        return;
      }
      const windowOpen = Date.now() < conversationUntilRef.current;
      if (!wakeWordEnabledRef.current || windowOpen) {
        const phrase = transcript.trim();
        if (isNoise(phrase)) {
          console.debug("[voice] ignored: noise/filler", phrase);
          return;
        }
        console.debug("[voice] follow-up accepted (no wake word)", phrase);
        openConversationWindow();
        await route(phrase, "voice");
        return;
      }
      console.debug("[voice] ignored: no wake word, window closed", transcript);
    },
    [route, openConversationWindow],
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
    // Echo guard: anything heard while JARVIS is speaking (or in the short
    // grace period right after) is his own TTS bleeding into the mic.
    const isEchoWindow = () =>
      speakingRef.current || Date.now() - lastSpeakEndRef.current < ECHO_GRACE_MS;

    const flush = () => {
      clearTimers();
      const phrase = speechBuffer.trim();
      speechBuffer = "";
      if (!phrase) return;
      if (isEchoWindow()) {
        console.debug("[voice] dropped (echo guard)", phrase);
        return;
      }
      console.debug("[voice] flush", phrase);
      setLastTranscript(phrase);
      void routeFromMic(phrase);
    };

    rec.onresult = (e) => {
      console.log("RAW EVENT RECEIVED", e.results, "resultIndex=", e.resultIndex);
      if (isEchoWindow()) {
        // Discard everything captured while TTS is audible — including any
        // partial phrase from just before, so a user fragment can't get
        // glued to echo fragments.
        speechBuffer = "";
        clearTimers();
        return;
      }
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

  const routeText = useCallback((text: string) => route(text, "chat"), [route]);
  const performAction = useCallback(
    (action: JarvisAction, spokenLine?: string) => {
      const mapped = ACTION_MAP[action];
      if (mapped) fire(mapped, spokenLine);
    },
    [fire],
  );

  const value = useMemo<Ctx>(
    () => ({
      enabled,
      supported,
      listening,
      inConversation,
      lastTranscript,
      setEnabled,
      consumePendingModule,
      routeText,
      performAction,
    }),
    [
      enabled,
      supported,
      listening,
      inConversation,
      lastTranscript,
      setEnabled,
      consumePendingModule,
      routeText,
      performAction,
    ],
  );

  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}
