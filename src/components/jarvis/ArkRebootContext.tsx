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
import { speak } from "@/lib/audio/speak";
import { playRebootIntro, playClickBeep } from "@/lib/audio/arkReboot";

export type RebootStep = {
  path: string;
  module: string;
  log: string;
};

export const REBOOT_SEQUENCE: RebootStep[] = [
  { path: "/", module: "DASHBOARD", log: "[DASHBOARD: CORE REFRESHED // 100%]" },
  { path: "/agent-hub", module: "AGENT HUB", log: "[AGENT_HUB: RECONNECTING NEURAL AGENTS...]" },
  {
    path: "/sub-systems",
    module: "SUB-SYSTEMS",
    log: "[SUB_SYSTEMS: COMPILING LOGISTICS UTILITIES...]",
  },
  {
    path: "/situation-room",
    module: "SITUATION ROOM",
    log: "[SITUATION_ROOM: CALIBRATING SATELLITE LINKS...]",
  },
  {
    path: "/system-logs",
    module: "SYSTEM LOGS",
    log: "[SYSTEM_LOGS: CLEARING BUFFER & STABILIZING...]",
  },
  { path: "/settings", module: "SETTINGS", log: "[SETTINGS: RESTORING USER PREFERENCES...]" },
];

type Ctx = {
  isDiagnosticRunning: boolean;
  currentStep: number;
  current: RebootStep | null;
  logTail: string[];
  flashKey: number;
  startReboot: () => void;
};

const ArkCtx = createContext<Ctx>({
  isDiagnosticRunning: false,
  currentStep: -1,
  current: null,
  logTail: [],
  flashKey: 0,
  startReboot: () => {},
});

export const useArkReboot = () => useContext(ArkCtx);

const STEP_INTERVAL_MS = 700;
const BLACKOUT_MS = 1500;
const STABILIZE_MS = 1300;

export function ArkRebootProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isDiagnosticRunning, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [logTail, setLogTail] = useState<string[]>([]);
  const [flashKey, setFlashKey] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runningRef = useRef(false);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // External trigger bridge — voice + chat dispatch this since the
  // VoiceCommandProvider is mounted above us in the tree.
  useEffect(() => {
    function onTrigger() {
      startRebootRef.current?.();
    }
    window.addEventListener("jarvis:reboot", onTrigger);
    return () => window.removeEventListener("jarvis:reboot", onTrigger);
  }, []);

  const startRebootRef = useRef<() => void>(() => {});

  const startReboot = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setCurrentStep(-1);
    setLogTail([]);

    // Phase 1 — Blackout & audio intro.
    playRebootIntro();
    speak(
      "Rozpoczynam pełną procedurę restartu rdzenia, Panie Sławiński. Wyłączam sub-systemy pomocnicze.",
    );

    // Phase 2 — Module tour, scheduled cascade.
    REBOOT_SEQUENCE.forEach((step, i) => {
      const at = BLACKOUT_MS + i * STEP_INTERVAL_MS;
      timersRef.current.push(
        setTimeout(() => {
          try {
            router.navigate({ to: step.path });
          } catch {
            /* ignore — router may be transitioning */
          }
          setCurrentStep(i);
          setLogTail((prev) => [...prev.slice(-2), step.log]);
          setFlashKey((k) => k + 1);
          playClickBeep();
        }, at),
      );
    });

    // Phase 3 — Stabilize and return to dashboard.
    const totalTourMs = BLACKOUT_MS + REBOOT_SEQUENCE.length * STEP_INTERVAL_MS;
    timersRef.current.push(
      setTimeout(() => {
        try {
          router.navigate({ to: "/" });
        } catch {
          /* ignore */
        }
        speak(
          "Wszystkie systemy w pełni sprawne, Panie Sławiński. Stabilność Arc Core na poziomie 100%. Jesteśmy online.",
        );
      }, totalTourMs),
    );
    timersRef.current.push(
      setTimeout(() => {
        setRunning(false);
        setCurrentStep(-1);
        setLogTail([]);
        runningRef.current = false;
      }, totalTourMs + STABILIZE_MS),
    );
  }, [router]);
  startRebootRef.current = startReboot;

  const current = currentStep >= 0 ? REBOOT_SEQUENCE[currentStep] : null;

  return (
    <ArkCtx.Provider
      value={{
        isDiagnosticRunning,
        currentStep,
        current,
        logTail,
        flashKey,
        startReboot,
      }}
    >
      {children}
    </ArkCtx.Provider>
  );
}
