import { describe, expect, it } from "vitest";
import {
  LOGIN_SCENE_DEFAULT_ENABLED,
  canUseLoginScene,
  hasWebGl,
  isLoginSceneEnabled,
} from "./loginScene";

describe("isLoginSceneEnabled", () => {
  it("falls back to LOGIN_SCENE_DEFAULT_ENABLED (the one rollout line)", () => {
    expect(isLoginSceneEnabled({ search: "", stored: null })).toBe(LOGIN_SCENE_DEFAULT_ENABLED);
  });

  it("?loginScene=1 turns it on", () => {
    expect(isLoginSceneEnabled({ search: "?loginScene=1", stored: null })).toBe(true);
    expect(isLoginSceneEnabled({ search: "?a=b&loginScene=1", stored: null })).toBe(true);
  });

  it("localStorage '1' turns it on", () => {
    expect(isLoginSceneEnabled({ search: "", stored: "1" })).toBe(true);
  });

  it("ignores junk values (falls back to the default)", () => {
    expect(isLoginSceneEnabled({ search: "?loginScene=yes", stored: "true" })).toBe(
      LOGIN_SCENE_DEFAULT_ENABLED,
    );
  });

  it("URL beats storage, and '0' is an explicit opt-out", () => {
    expect(isLoginSceneEnabled({ search: "?loginScene=0", stored: "1" })).toBe(false);
    expect(isLoginSceneEnabled({ search: "?loginScene=1", stored: "0" })).toBe(true);
    expect(isLoginSceneEnabled({ search: "", stored: "0" })).toBe(false);
  });

  it("is SSR-safe (no window)", () => {
    expect(isLoginSceneEnabled()).toBe(LOGIN_SCENE_DEFAULT_ENABLED);
  });
});

describe("canUseLoginScene", () => {
  it("needs switch + HUD skin + WebGL", () => {
    expect(canUseLoginScene({ enabled: true, mode: "hud", webgl: true })).toBe(true);
    expect(canUseLoginScene({ enabled: false, mode: "hud", webgl: true })).toBe(false);
    expect(canUseLoginScene({ enabled: true, mode: "town", webgl: true })).toBe(false);
    expect(canUseLoginScene({ enabled: true, mode: "hud", webgl: false })).toBe(false);
  });
});

describe("hasWebGl (smoke: no WebGL → old SVG path)", () => {
  const docWith = (getContext: () => unknown) =>
    ({ createElement: () => ({ getContext }) }) as unknown as Pick<Document, "createElement">;

  it("is false without a document (SSR)", () => {
    expect(hasWebGl(undefined)).toBe(false);
  });

  it("is false when the browser returns no context", () => {
    expect(hasWebGl(docWith(() => null))).toBe(false);
  });

  it("is false when context creation throws", () => {
    expect(
      hasWebGl(
        docWith(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(false);
  });

  it("is true with a context, and releases it", () => {
    let lost = 0;
    const gl = { getExtension: () => ({ loseContext: () => lost++ }) };
    expect(hasWebGl(docWith(() => gl))).toBe(true);
    expect(lost).toBe(1);
  });
});
