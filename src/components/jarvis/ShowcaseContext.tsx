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
import { listAgents, type AgentSummary } from "@/lib/agents/runtime.functions";
import { useArkReboot } from "./ArkRebootContext";
import {
  SHOWCASE_SEQUENCE,
  SHOWCASE_COLD_OPEN,
  SHOWCASE_OUTRO,
  SHOWCASE_BUILD_MS,
  type ShowcaseStep,
} from "@/lib/showcase/sequence";

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

export function ShowcaseProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isDiagnosticRunning } = useArkReboot();
  const fetchAgents = useServerFn(listAgents);

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

  const skip = useCallback(() => {
    if (!runningRef.current) return;
    clearTimers();
    speakCancel();
    runningRef.current = false;
    setRunning(false);
    setPhase("idle");
    setStepIndex(-1);
    try {
      router.navigate({ to: "/" });
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

    let t = SHOWCASE_COLD_OPEN.durationMs;
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
        }, t),
      );
      t += step.displayMs;
    });

    timersRef.current.push(
      setTimeout(() => {
        try {
          router.navigate({ to: "/" });
        } catch {
          /* ignore */
        }
        setPhase("outro");
        setStepIndex(-1);
        speak(SHOWCASE_OUTRO.narration);
      }, t),
    );
    t += SHOWCASE_OUTRO.durationMs;

    timersRef.current.push(
      setTimeout(() => {
        runningRef.current = false;
        setRunning(false);
        setPhase("idle");
        setStepIndex(-1);
      }, t),
    );
  }, [fetchAgents, isDiagnosticRunning, router]);

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
