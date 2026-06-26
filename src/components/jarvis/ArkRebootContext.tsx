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
  narration: string;
};

export const REBOOT_SEQUENCE: RebootStep[] = [
  {
    path: "/",
    module: "DASHBOARD",
    log: "[DASHBOARD: CORE REFRESHED // 100%]",
    narration:
      "Rebuilding Main Command Dashboard. Securing biometric telemetry.",
  },
  {
    path: "/agent-hub",
    module: "AGENT HUB",
    log: "[AGENT_HUB: RECONNECTING NEURAL AGENTS...]",
    narration:
      "Activating Neural Agent Hub. Establishing AI core protocols.",
  },
  {
    path: "/sub-systems",
    module: "SUB-SYSTEMS",
    log: "[SUB_SYSTEMS: COMPILING LOGISTICS UTILITIES...]",
    narration:
      "Compiling system utilities, vehicle fuel matrices, and CV optimization algorithms.",
  },
  {
    path: "/geo-tracking",
    module: "GEO-TRACKING",
    log: "[GEO_TRACKING: CALIBRATING SATELLITE LINKS...]",
    narration:
      "Calibrating satellite links. Synchronizing real-time coordinate streams.",
  },
  {
    path: "/system-logs",
    module: "SYSTEM LOGS",
    log: "[SYSTEM_LOGS: CLEARING BUFFER & STABILIZING...]",
    narration:
      "Flushing buffer arrays. Initiating secure encrypted datastream.",
  },
  {
    path: "/settings",
    module: "SETTINGS",
    log: "[SETTINGS: RESTORING USER PREFERENCES...]",
    narration:
      "Restoring custom user directives and deep interface preferences.",
  },
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

export const STEP_INTERVAL_MS = 2500;
export const BLACKOUT_MS = 1500;
export const STABILIZE_MS = 1500;

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
      "Initiating full core reboot sequence, Sir. Powering down secondary sub-systems.",
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
          // Jarvis describes the module as it materializes.
          speak(step.narration);
        }, at),
      );
    });

    // Phase 3 — Stabilize: pause on SETTINGS, final flash, then home.
    const totalTourMs = BLACKOUT_MS + REBOOT_SEQUENCE.length * STEP_INTERVAL_MS;
    timersRef.current.push(
      setTimeout(() => {
        setFlashKey((k) => k + 1);
        try {
          router.navigate({ to: "/" });
        } catch {
          /* ignore */
        }
        speak(
          "All systems fully operational, Mr. Slawinsky. Arc Core stability at 100%. We are online.",
        );
      }, totalTourMs + STABILIZE_MS),
    );
    timersRef.current.push(
      setTimeout(() => {
        setRunning(false);
        setCurrentStep(-1);
        setLogTail([]);
        runningRef.current = false;
      }, totalTourMs + STABILIZE_MS + 900),
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