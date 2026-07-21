import { createContext, useContext } from "react";

export type AppPhase =
  | "booting"
  | "login_screen"
  | "initializing"
  | "transition_to_dashboard"
  | "dashboard_active"
  | "shutdown";

export const PhaseContext = createContext<{
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;
}>({ phase: "booting", setPhase: () => {} });

export const usePhase = () => useContext(PhaseContext);
