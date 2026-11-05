import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArcReactorTriangle } from "./ArcReactorTriangle";
import { LOGIN_REACTOR_SLOT_ATTR } from "@/lib/theme/loginScene";

// Smoke: the old SVG reactor is the default, and only an explicit `slot`
// (set when the 3D login scene is active) swaps it for the empty box the
// scene reads its rect from. Without WebGL the scene is never active, so the
// SVG path below is what the user gets.
describe("ArcReactorTriangle: SVG fallback vs 3D slot", () => {
  it("renders the SVG reactor by default (no WebGL / switch off / Town)", () => {
    const html = renderToStaticMarkup(createElement(ArcReactorTriangle, { raised: true }));
    expect(html).toContain("<svg");
    expect(html).toContain('id="arc-core"');
    expect(html).not.toContain(LOGIN_REACTOR_SLOT_ATTR);
  });

  it("renders an empty slot of the same box when the 3D scene is active", () => {
    const svg = renderToStaticMarkup(createElement(ArcReactorTriangle, { raised: true }));
    const slot = renderToStaticMarkup(
      createElement(ArcReactorTriangle, { raised: true, slot: true }),
    );
    expect(slot).toContain(LOGIN_REACTOR_SLOT_ATTR);
    expect(slot).not.toContain("<svg");
    // identical sizing/placement classes on the outer box
    const cls = (h: string) => /class="([^"]*)"/.exec(h)?.[1];
    expect(cls(slot)).toBe(cls(svg));
  });
});
