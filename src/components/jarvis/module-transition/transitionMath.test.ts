import { describe, expect, it } from "vitest";
import {
  FAST_FACTOR,
  MODULE_AGENT,
  SWAP_AT,
  TRANSITION_MS,
  TUNNEL_BOARD_Z,
  coreEnterAlign,
  coreEnterCamera,
  coreEnterHandoff,
  coreEnterOverlay,
  coreLeaveAlign,
  coreLeaveFlash,
  coreLeaveOverlay,
  coreLeaveTravel,
  isFastJump,
  moduleBoard,
  pickKind,
  transitionDuration,
  tunnelBoardOpacity,
  tunnelBoardWidth,
  tunnelCamZ,
  tunnelFlash,
  tunnelGateScale,
  tunnelOverlay,
} from "./transitionMath";

describe("which transition", () => {
  it("into /jarvis and out of it go through the Arc Core, the rest through the tunnel", () => {
    expect(pickKind("/", "/jarvis")).toBe("core-enter");
    expect(pickKind("/jarvis", "/documents")).toBe("core-leave");
    expect(pickKind("/", "/rynki")).toBe("tunnel");
    expect(pickKind("/system-logs", "/mozg")).toBe("tunnel");
  });
  it("tempo 1×: the approved demo timings", () => {
    expect(TRANSITION_MS).toEqual({ tunnel: 950, "core-enter": 1500, "core-leave": 1350 });
    expect(transitionDuration("tunnel", false)).toBe(950);
  });
  it("a second jump within 2.5 s is shorter", () => {
    expect(transitionDuration("tunnel", true)).toBe(Math.round(950 * FAST_FACTOR));
    expect(isFastJump(10_000, 8_000)).toBe(true);
    expect(isFastJump(10_000, 7_000)).toBe(false);
    expect(isFastJump(10_000, 0)).toBe(false);
  });
  it("the route swaps late, while the overlay still covers the screen", () => {
    expect(tunnelOverlay(SWAP_AT.tunnel)).toBe(1);
    expect(coreEnterOverlay(SWAP_AT["core-enter"])).toBe(1);
    expect(coreLeaveOverlay(SWAP_AT["core-leave"])).toBe(1);
  });
});

describe("module boards and agents", () => {
  it("modules.ts title, index and the approved one-liner", () => {
    const b = moduleBoard("/rynki");
    expect(b.title).toBe("Rynki");
    expect(b.sub).toBe("Wykresy instrumentów i paper fund");
    expect(b.index).toBeGreaterThan(0);
  });
  it("modules without a one-liner fall back to their group label", () => {
    expect(moduleBoard("/settings").sub).toBe("System");
  });
  it("sub-routes are named after their leaf, under the parent module", () => {
    const b = moduleBoard("/agent-hub/forge");
    expect(b.title).toBe("forge");
    expect(b.sub).toBe("Agent Hub");
  });
  it("agent owners use real agent slugs", () => {
    const slugs = new Set(["shield", "herald", "insight", "metric", "forge"]);
    expect(Object.values(MODULE_AGENT).every((s) => slugs.has(s))).toBe(true);
    expect(MODULE_AGENT["/documents"]).toBe("metric");
  });
});

describe("tunnel curves", () => {
  it("camera flies from 420 to -1260 through the board", () => {
    expect(tunnelCamZ(0)).toBe(420);
    expect(tunnelCamZ(1)).toBe(-1260);
    expect(tunnelCamZ(1)).toBeLessThan(TUNNEL_BOARD_Z);
  });
  it("board: invisible far away, readable on approach, gone once passed", () => {
    expect(tunnelBoardOpacity(TUNNEL_BOARD_Z + 1000)).toBe(0);
    expect(tunnelBoardOpacity(TUNNEL_BOARD_Z + 300)).toBeGreaterThan(0.9);
    expect(tunnelBoardOpacity(TUNNEL_BOARD_Z - 5)).toBe(0);
  });
  it("board and gates fit a portrait phone frame", () => {
    expect(tunnelBoardWidth(39, 0.46, 0.5)).toBeLessThan(tunnelBoardWidth(39, 1.78, 0.5));
    expect(tunnelBoardWidth(39, 3, 0)).toBe(620);
    expect(tunnelGateScale(0.46)).toBeLessThan(1);
    expect(tunnelGateScale(1.78)).toBe(1);
  });
  it("overlay and flash stay within their bounds", () => {
    expect(tunnelOverlay(0)).toBe(0);
    expect(tunnelOverlay(1)).toBe(0);
    for (let i = 0; i <= 100; i++) expect(tunnelFlash(i / 100)).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});

describe("Arc Core curves", () => {
  it("entering ends on the /jarvis frame: azimuth 0, fov 45, aligned to the canvas", () => {
    const e = coreEnterCamera(1);
    expect(e.az).toBe(0);
    expect(e.fov).toBe(45);
    expect(coreEnterAlign(1)).toBe(1);
    expect(coreEnterAlign(SWAP_AT["core-enter"])).toBe(0);
    expect(coreEnterHandoff(0.5)).toBe(true);
    expect(coreEnterHandoff(0.95)).toBe(false);
  });
  it("leaving starts on the /jarvis canvas frame and reaches the dive by 80%", () => {
    expect(coreLeaveAlign(0)).toBe(1);
    expect(coreLeaveAlign(0.3)).toBe(0);
    expect(coreLeaveTravel(0.8)).toBe(1);
    expect(coreLeaveOverlay(0)).toBe(1);
    expect(coreLeaveOverlay(1)).toBe(0);
    expect(coreLeaveFlash(0.81)).toBeGreaterThan(0.5);
  });
});
