import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArcReactorTriangle } from "./ArcReactorTriangle";

// Smoke: the classic SVG reactor is what renders on the old path (no WebGL,
// switch off, Town skin) — the 3D intro never replaces this component.
describe("ArcReactorTriangle (SVG fallback)", () => {
  it("renders the SVG reactor", () => {
    const html = renderToStaticMarkup(createElement(ArcReactorTriangle, { raised: true }));
    expect(html).toContain("<svg");
    expect(html).toContain('id="arc-core"');
    expect(html).not.toContain("data-login-reactor-slot");
  });
});
