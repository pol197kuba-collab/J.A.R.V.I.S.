import type { LandingHost, LandingHud } from "./createLoginScene";

/** Shared between PhaseController, LandingPage and the scene (no React renders per frame). */
export interface IntroBridge {
  /** Filled by LandingPage: the scroll container and its stop sections. */
  host: LandingHost | null;
  /** Filled by LandingPage: receives the per-frame HUD readout. */
  onHud: ((h: LandingHud) => void) | null;
}

export const createIntroBridge = (): IntroBridge => ({ host: null, onHud: null });
