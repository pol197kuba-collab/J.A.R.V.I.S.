import { useEffect, useRef, useState } from "react";
import { resolveSceneColors } from "@/components/jarvis/login-scene/sceneColors";
import { useRouteTransition } from "./TransitionContext";
import { MiniArcCore } from "./MiniArcCore";
import {
  MINI_CORE_BUTTON_PX,
  MINI_CORE_CANVAS_PX,
  holdCharge,
  miniCoreSpin,
} from "./module-transition/miniCoreMath";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { MiniCore } from "./module-transition/createMiniCore";

/**
 * The dock's menu button face: the /jarvis Arc Core in miniature (real 3D —
 * same shader, rings, shell, corona and bloom, no agents), on its own small
 * canvas blended with `screen` so only the light shows. Without the 3D layer
 * (Town, no WebGL, reduced motion, switch off) or before three loads, the CSS
 * MiniArcCore stands in.
 */
export function DockCore({
  state,
  charging,
  size = MINI_CORE_BUTTON_PX,
}: {
  state: "idle" | "busy" | "error";
  charging: boolean;
  /** Button size (px); the canvas is a little larger so the glow never clips. */
  size?: number;
}) {
  const canvasPx = Math.round((size * MINI_CORE_CANVAS_PX) / MINI_CORE_BUTTON_PX);
  const { can3d } = useRouteTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const live = useRef({ state, chargeStart: 0 });
  live.current.state = state;
  useEffect(() => {
    live.current.chargeStart = charging ? performance.now() : 0;
  }, [charging]);

  useEffect(() => {
    if (!can3d) return;
    let cancelled = false;
    let mini: MiniCore | null = null;
    (async () => {
      try {
        const { createMiniCore } = await import("./module-transition/createMiniCore");
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        mini = createMiniCore(canvas, resolveSceneColors(), () => {
          const l = live.current;
          return {
            spin: miniCoreSpin(l.state),
            charge: l.chargeStart ? holdCharge(performance.now() - l.chargeStart) : 0,
          };
        });
        setReady(true);
      } catch (err) {
        console.warn("[dock-core] 3D unavailable, keeping the CSS core", err);
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
      mini?.dispose();
    };
  }, [can3d]);

  return (
    <span
      aria-hidden
      className="pointer-events-none relative block"
      style={{ width: size, height: size }}
    >
      {can3d && (
        <canvas
          ref={canvasRef}
          className="absolute top-1/2 left-1/2 block -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
          style={{
            width: canvasPx,
            height: canvasPx,
            mixBlendMode: "screen",
            // the corona fades out in a circle instead of ending at the canvas edge
            maskImage: "radial-gradient(circle closest-side, black 74%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle closest-side, black 74%, transparent 100%)",
            opacity: ready ? 1 : 0,
            // an agent error: the same red alarm glow as the CSS core
            filter:
              state === "error"
                ? "drop-shadow(0 0 8px color-mix(in oklab, var(--destructive) 80%, transparent))"
                : undefined,
          }}
        />
      )}
      {!ready && (
        <span className="absolute inset-0 flex items-center justify-center">
          <MiniArcCore size={size} state={state} charging={charging} />
        </span>
      )}
    </span>
  );
}
