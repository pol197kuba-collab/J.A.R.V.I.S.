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
import { logClientEvent } from "@/lib/system/logClientEvent";
import { COMMAND_REGISTRY, getCommand, type CommandActionId } from "@/lib/commands/registry";

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
   * Used by ChatPanel when the server-routed jarvis core already resolved
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
  return cleaned
    .slice(lastEnd)
    .replace(/^[\s,.:;!?-]+/, "")
    .trim();
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

export type AnySpeechRecognition = {
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

export function getSpeechCtor(): (new () => AnySpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => AnySpeechRecognition;
    webkitSpeechRecognition?: new () => AnySpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Local action id = the command's registry id. Kept as a distinct alias so
// call sites read naturally, but there is no separate mapping table anymore
// — JarvisAction IS a CommandActionId (jarvisBrain.ts's JARVIS_ACTIONS is
// "none" + every registry id), so routing a Gemini reply's action straight
// into fire() needs no lookup beyond "is this id in the registry".
type LocalAction = CommandActionId;

const COMMANDS: Array<{ re: RegExp; action: LocalAction }> = COMMAND_REGISTRY.map((c) => ({
  re: c.pattern,
  action: c.id,
}));

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
        action === "vision_scan" ||
        action === "demo_showcase"
          ? 2000
          : 500;
      const last = lastFireMapRef.current.get(action) ?? 0;
      if (now - last < window_ms) return;
      lastFireMapRef.current.set(action, now);
      const say = (fallback: string) =>
        speak(spokenLine && spokenLine.trim() ? spokenLine : fallback);

      const cmd = getCommand(action);
      if (!cmd) {
        // Registry lookup failed for a value that passed the LocalAction
        // type — should be unreachable, but fail loudly rather than
        // silently doing nothing (that exact silent-no-op bug shipped once
        // for open_documents/open_schema before this registry existed).
        console.error("[voice] no registry entry for action", action);
        return;
      }

      // Data-driven cases: plain route navigation, or a /sub-systems
      // navigation with a pending module handoff. Every other command has
      // bespoke side effects and is handled explicitly below.
      if (cmd.kind.type === "route") {
        say(cmd.confirmation);
        go(cmd.kind.path);
        return;
      }
      if (cmd.kind.type === "module") {
        pendingRef.current = cmd.kind.module;
        say(cmd.confirmation);
        go("/sub-systems");
        return;
      }

      switch (action) {
        case "open_menu":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "open" }));
          if (spokenLine) speak(spokenLine);
          break;
        case "close_menu":
          window.dispatchEvent(new CustomEvent("jarvis:sidebar", { detail: "close" }));
          if (spokenLine) speak(spokenLine);
          break;
        case "system_check":
          say(cmd.confirmation);
          break;
        case "sleep":
          say(cmd.confirmation);
          setEnabled(false);
          break;
        case "shutdown":
          say(cmd.confirmation);
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
          say(cmd.confirmation);
          try {
            window.sessionStorage.setItem("jarvis_pending_scan", "1");
          } catch {
            /* ignore */
          }
          window.dispatchEvent(new CustomEvent("jarvis:vision-scan"));
          go("/vision");
          break;
        case "demo_showcase":
          // Bridge to ShowcaseProvider (mounted below this provider). It
          // speaks its own cold-open line — don't ALSO speak cmd.confirmation
          // here, or the two lines would queue back to back (see "reboot").
          window.dispatchEvent(new CustomEvent("jarvis:showcase"));
          if (spokenLine) speak(spokenLine);
          break;
        default:
          // Every "route"/"module" kind returned above; every remaining
          // "special" id must have an explicit case here. Adding a new
          // "special" command without one is exactly the silent-no-op bug
          // that shipped for open_documents/open_schema — surface it loudly.
          console.error("[voice] no special-case handler for action", action);
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
      const throttleMs = source === "chat" ? GEMINI_CHAT_THROTTLE_MS : GEMINI_VOICE_THROTTLE_MS;
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
      if (reply.action !== "none") {
        fire(reply.action, reply.speech);
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
      void logClientEvent("warn", "voice", "SpeechRecognition not supported in this browser");
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
      void logClientEvent(
        "error",
        "voice",
        `speech recognition engine error: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      } catch {
        /* ignore */
      }
      recRef.current = null;
      setListening(false);
    };
  }, [enabled, Ctor, routeFromMic]);

  const routeText = useCallback((text: string) => route(text, "chat"), [route]);
  const performAction = useCallback(
    (action: JarvisAction, spokenLine?: string) => {
      if (action !== "none") fire(action, spokenLine);
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
