// Feature switch + capability checks for the 3D login → Arc Core scene
// (src/components/jarvis/login-scene/). Pure, SSR-safe, no three.js import —
// PhaseController and StarkLogin read this on every client, so it must never
// drag the 3D chunk into the main bundle.
//
// Off by default until the scene is approved. Opt in with `?loginScene=1` in
// the URL or `localStorage["jarvis.loginScene"] = "1"` (opt out with "0",
// which beats the default once it flips to true).

import { getUiMode, type UiMode } from "@/lib/theme/uiMode";

/** THE ONE LINE to change to roll the scene out to everyone. */
export const LOGIN_SCENE_DEFAULT_ENABLED = true;

export const LOGIN_SCENE_KEY = "jarvis.loginScene";
export const LOGIN_SCENE_PARAM = "loginScene";

/** StarkLogin marks the empty box where the 3D reactor goes. */
export const LOGIN_REACTOR_SLOT_ATTR = "data-login-reactor-slot";
/** Dispatched on window by StarkLogin.deny() on a wrong key; the scene shakes the reactor. */
export const LOGIN_DENIED_EVENT = "jarvis:login-denied";

export interface LoginSceneEnv {
  /** `window.location.search`, or "" when there is no window. */
  search: string;
  /** Stored override, "1" / "0" / null. */
  stored: string | null;
}

function readEnv(): LoginSceneEnv {
  if (typeof window === "undefined") return { search: "", stored: null };
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LOGIN_SCENE_KEY);
  } catch {
    /* storage unavailable — fall through to URL / default */
  }
  return { search: window.location.search, stored };
}

function flag(v: string | null | undefined): boolean | null {
  return v === "1" ? true : v === "0" ? false : null;
}

/** URL param wins over localStorage, which wins over the default. */
export function isLoginSceneEnabled(env: LoginSceneEnv = readEnv()): boolean {
  const fromUrl = flag(new URLSearchParams(env.search).get(LOGIN_SCENE_PARAM));
  if (fromUrl !== null) return fromUrl;
  const fromStore = flag(env.stored);
  if (fromStore !== null) return fromStore;
  return LOGIN_SCENE_DEFAULT_ENABLED;
}

/** Can this browser create a WebGL context at all? (releases the probe context) */
export function hasWebGl(doc: Pick<Document, "createElement"> | undefined = defaultDoc()): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const gl = (canvas.getContext?.("webgl2") ?? canvas.getContext?.("webgl")) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null
      | undefined;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function defaultDoc(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/**
 * Should the 3D scene be used for this login? Only on the HUD skin, only when
 * switched on, only with WebGL. Everything else keeps today's SVG + BootSequence.
 * (prefers-reduced-motion does NOT disable it — it selects the "min" variant.)
 */
export function canUseLoginScene(o: { enabled: boolean; mode: UiMode; webgl: boolean }): boolean {
  return o.enabled && o.mode === "hud" && o.webgl;
}

/** Evaluate every condition against the live browser (client only). */
export function shouldUseLoginScene(): boolean {
  return canUseLoginScene({
    enabled: isLoginSceneEnabled(),
    mode: getUiMode(),
    webgl: hasWebGl(),
  });
}
