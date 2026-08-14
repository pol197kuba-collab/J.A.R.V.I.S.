import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { speak, speakCancel } from "@/lib/audio/speak";
import { audio } from "@/lib/audio/AudioEngine";
import {
  listAgents,
  runAgent,
  getActiveConversation,
  type AgentSummary,
} from "@/lib/agents/runtime.functions";
import { emitChat } from "@/lib/ai/chatBus";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { useArkReboot } from "./ArkRebootContext";
import {
  SHOWCASE_SEQUENCE,
  SHOWCASE_COLD_OPEN,
  SHOWCASE_OUTRO,
  SHOWCASE_BUILD_MS,
  type ShowcaseStep,
} from "@/lib/showcase/sequence";
import { estimateNarrationMs } from "@/lib/showcase/timing";

export type ShowcasePhase = "idle" | "coldopen" | "building" | "step" | "outro";

type Ctx = {
  isRunning: boolean;
  phase: ShowcasePhase;
  stepIndex: number;
  stepCount: number;
  current: ShowcaseStep | null;
  agents: AgentSummary[];
  start: () => void;
  skip: () => void;
};

const ShowcaseCtx = createContext<Ctx>({
  isRunning: false,
  phase: "idle",
  stepIndex: -1,
  stepCount: SHOWCASE_SEQUENCE.length,
  current: null,
  agents: [],
  start: () => {},
  skip: () => {},
});

export const useShowcase = () => useContext(ShowcaseCtx);

/** A gentle three-note ascending chime — distinct from Ark Reboot's bass
 *  sweep, since this is a "look what I can do" moment, not a system alarm. */
function playShowcaseChime() {
  audio.playBeep(660, 0.1, 0.2);
  setTimeout(() => audio.playBeep(880, 0.1, 0.22), 110);
  setTimeout(() => audio.playBeep(1320, 0.16, 0.26), 220);
}

// Prompt for the "agent-matrix-demo" flourish — phrased to match the exact
// "zademonstruj ich możliwości" pattern the orchestrator's own system prompt
// (runtime.server.ts) already recognizes as "delegate to several teammates
// in this turn", and asked for SHORT sub-tasks so it resolves quickly rather
// than kicking off something slow mid-demo.
const AGENT_MATRIX_DEMO_PROMPT =
  "Zademonstruj Agent Matrix: krótko deleguj po jednym prostym zadaniu testowym do dwóch lub trzech dostępnych agentów jednocześnie (np. jednozdaniowe przywitanie albo streszczenie), żeby pokazać jak wygląda delegacja w czasie rzeczywistym.";

export function ShowcaseProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isDiagnosticRunning } = useArkReboot();
  const fetchAgents = useServerFn(listAgents);
  const fetchActiveConversation = useServerFn(getActiveConversation);
  const runAgentFn = useServerFn(runAgent);

  const [isRunning, setRunning] = useState(false);
  const [phase, setPhase] = useState<ShowcasePhase>("idle");
  const [stepIndex, setStepIndex] = useState(-1);
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  const runningRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Fires a REAL delegation turn through the actual orchestrator so the
  // Agent Matrix (JarvisCanvas on /jarvis) lights up with genuine activity
  // — busy status, glowing spokes, live task/progress cards — instead of a
  // faked animation. Appends to the user's existing J.A.R.V.I.S. conversation
  // (fetched first, same as jarvisBrain.ts's resolveConversationId) rather
  // than an omitted conversationId, which would otherwise fork a new thread
  // that then hijacks "most recently updated" on every other chat surface.
  // Best-effort and silent: no Gemini/Groq key configured, or the call
  // failing outright, just means the matrix stays at its idle animation —
  // never blocks or visibly errors the showcase itself.
  const triggerAgentMatrixDemo = useCallback(() => {
    fetchActiveConversation({ data: { agentSlug: AGENT_SLUGS.JARVIS } })
      .then((conv) =>
        runAgentFn({
          data: {
            agentSlug: AGENT_SLUGS.JARVIS,
            input: AGENT_MATRIX_DEMO_PROMPT,
            conversationId: conv.conversationId ?? undefined,
          },
        }),
      )
      .then((result) => {
        if (result.status === "done" && result.output) {
          emitChat("user", AGENT_MATRIX_DEMO_PROMPT);
          // Not spoken — the showcase's own scripted narration owns the
          // voice channel for this step, two overlapping TTS lines would
          // just talk over each other.
          emitChat("jarvis", result.output);
        }
      })
      .catch(() => {
        /* best-effort — matrix simply stays idle */
      });
  }, [fetchActiveConversation, runAgentFn]);

  const skip = useCallback(() => {
    if (!runningRef.current) return;
    clearTimers();
    speakCancel();
    runningRef.current = false;
    setRunning(false);
    setPhase("idle");
    setStepIndex(-1);
    try {
      router.navigate({ to: "/jarvis" });
    } catch {
      /* ignore — router may be transitioning */
    }
  }, [clearTimers, router]);

  const start = useCallback(() => {
    if (runningRef.current || isDiagnosticRunning) return;
    runningRef.current = true;
    setRunning(true);
    setPhase("coldopen");
    setStepIndex(-1);

    // Real agent roster for the Agent Hub flourish — best-effort, the demo
    // still runs (with a generic placeholder set) if this fails or the
    // account has none registered yet.
    fetchAgents()
      .then(setAgents)
      .catch(() => setAgents([]));

    playShowcaseChime();
    speak(SHOWCASE_COLD_OPEN.narration);

    let t = estimateNarrationMs(SHOWCASE_COLD_OPEN.narration);
    SHOWCASE_SEQUENCE.forEach((step, i) => {
      timersRef.current.push(
        setTimeout(() => {
          setPhase("building");
          setStepIndex(i);
        }, t),
      );
      t += SHOWCASE_BUILD_MS;
      timersRef.current.push(
        setTimeout(() => {
          try {
            router.navigate({ to: step.path });
          } catch {
            /* ignore */
          }
          setPhase("step");
          audio.playBeep(1100, 0.05, 0.16);
          speak(step.narration);
          if (step.flourish === "agent-matrix-demo") triggerAgentMatrixDemo();
        }, t),
      );
      t += estimateNarrationMs(step.narration);
    });

    timersRef.current.push(
      setTimeout(() => {
        try {
          router.navigate({ to: "/jarvis" });
        } catch {
          /* ignore */
        }
        setPhase("outro");
        setStepIndex(-1);
        speak(SHOWCASE_OUTRO.narration);
      }, t),
    );
    t += estimateNarrationMs(SHOWCASE_OUTRO.narration);

    timersRef.current.push(
      setTimeout(() => {
        runningRef.current = false;
        setRunning(false);
        setPhase("idle");
        setStepIndex(-1);
      }, t),
    );
  }, [fetchAgents, isDiagnosticRunning, router, triggerAgentMatrixDemo]);

  // Voice/text bridge — VoiceCommandProvider is mounted above this provider
  // and dispatches this event for the demo_showcase action, same pattern
  // ArkRebootContext uses for "jarvis:reboot".
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    function onTrigger() {
      startRef.current();
    }
    window.addEventListener("jarvis:showcase", onTrigger);
    return () => window.removeEventListener("jarvis:showcase", onTrigger);
  }, []);

  // Esc always cancels — the one promise made to the user up front.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") skip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip]);

  const current = stepIndex >= 0 ? SHOWCASE_SEQUENCE[stepIndex] : null;

  return (
    <ShowcaseCtx.Provider
      value={{
        isRunning,
        phase,
        stepIndex,
        stepCount: SHOWCASE_SEQUENCE.length,
        current,
        agents,
        start,
        skip,
      }}
    >
      {children}
    </ShowcaseCtx.Provider>
  );
}
