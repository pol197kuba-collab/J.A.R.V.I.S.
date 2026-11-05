// Colours of the login → Arc Core scene, as theme-token expressions. three.js
// cannot read CSS variables, so they are resolved to hex through
// src/lib/theme/themeColor.ts (the same path JarvisCanvas / Core3D use).
//
// FIDELITY: in the default JARVIS theme every entry resolves to the colour the
// prototype (docs/login-scene-prototype/src/reactor.js) hard-codes. The four
// real tokens (primary, accent, reactor, hot) are bit-exact. The helper tints
// below have no token of their own, so each is a color-mix of a token with
// white/black whose percentage was fitted to the prototype hex (max channel
// error is noted per entry). No module code may hard-code a hex — the
// FALLBACKS only seed SSR / a browser that cannot resolve the expression.
//
// This file has no three.js import; it is safe to import anywhere.

import { resolveCssColor } from "@/lib/theme/themeColor";

export const SCENE_COLOR_EXPR = {
  primary: "var(--primary)", // proto 0x00e6f9 — exact
  accent: "var(--accent)", // proto 0x73bdff — exact
  reactor: "var(--reactor)", // proto 0xffad00 — exact
  hot: "var(--reactor-hot)", // proto 0xffcd42 — exact
  destructive: "var(--destructive)", // wrong-key shake tint (proto 0xff4a3a, spec: token)
  paleCore: "color-mix(in oklab, var(--primary) 15%, white)", // 0xe6fdff, ±1
  ambient: "color-mix(in oklab, var(--primary) 80%, white)", // 0x66e8ff, ±4
  nodeWire: "color-mix(in oklab, var(--primary) 38%, white)", // 0xbff8ff, ±2
  spoke: "color-mix(in oklab, var(--primary) 77%, black)", // 0x0aa6b8, ±10
  glowMid: "color-mix(in oklab, var(--primary) 62%, black)", // gradient 0,120,132, ±1
  glowEdge: "color-mix(in oklab, var(--primary) 34%, black)", // gradient 0,50,56, ±2
  steel: "color-mix(in oklab, var(--background) 91%, white)", // 0x0c1b2a, ±6
  // v2 (core2.js, main.js)
  foreground: "var(--foreground)", // board title, proto #e3f6f9 — exact
  muted: "var(--muted-foreground)", // board subtitle, proto #76c7cc — exact
  boardFill: "color-mix(in oklab, var(--primary) 87%, black)", // rgb(0,190,210), ±3
  packetCyan: "color-mix(in oklab, var(--primary) 70%, white)", // 0x7ff4ff, ±5
  packetAmber: "color-mix(in oklab, var(--reactor-hot) 85%, white)", // 0xffd36a, ±2
  nodeWireAmber: "color-mix(in oklab, var(--reactor-hot) 58%, white)", // 0xffe1a0, ±2
  coronaMid: "color-mix(in oklab, var(--reactor) 78%, var(--destructive))", // rgb(255,120,0), alpha .12
  coronaEdge: "color-mix(in oklab, var(--reactor) 65%, var(--destructive))", // rgb(255,100,0), alpha 0
} as const;

export type SceneColorKey = keyof typeof SCENE_COLOR_EXPR;
export type SceneColors = Record<SceneColorKey, string>;

/** Default-theme values (the prototype hexes), used for SSR and as a safety net. */
export const SCENE_COLOR_FALLBACKS: SceneColors = {
  primary: "#00e6f9",
  accent: "#73bdff",
  reactor: "#ffad00",
  hot: "#ffcd42",
  destructive: "#ff4c4d",
  paleCore: "#e6fdff",
  ambient: "#66e8ff",
  nodeWire: "#bff8ff",
  spoke: "#0aa6b8",
  glowMid: "#007884",
  glowEdge: "#003238",
  steel: "#0c1b2a",
  foreground: "#e3f6f9",
  muted: "#76c7cc",
  boardFill: "#00bfcf",
  packetCyan: "#83effb",
  packetAmber: "#ffd56a",
  nodeWireAmber: "#ffe39f",
  coronaMid: "#ff9d25",
  coronaEdge: "#ff932f",
};

/** Resolve every scene colour against the live document / active theme. */
export function resolveSceneColors(): SceneColors {
  const out = { ...SCENE_COLOR_FALLBACKS };
  for (const k of Object.keys(SCENE_COLOR_EXPR) as SceneColorKey[]) {
    out[k] = resolveCssColor(SCENE_COLOR_EXPR[k], SCENE_COLOR_FALLBACKS[k]);
  }
  return out;
}
