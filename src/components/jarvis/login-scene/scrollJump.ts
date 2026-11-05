// Button jumps of the landing page run on their own requestAnimationFrame
// clock: native smooth scrolling crosses the whole ~15 000 px story in about a
// second, too fast to read, and it stutters. Constants and curves live in
// loginSceneMath.ts (JUMP_PX_PER_MS, JUMP_MIN_MS, JUMP_MAX_MS, easeInOut).
// Interrupted by wheel, touchstart and keydown; instant under reduced motion.

import { jumpMs, jumpPosition } from "./loginSceneMath";

export function createScrollJump(el: HTMLElement) {
  let raf = 0;
  let running = false;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    running = false;
  };
  const events = ["wheel", "touchstart", "keydown"] as const;
  events.forEach((ev) => window.addEventListener(ev, stop, { passive: true }));

  return {
    /**
     * Fly the container to `top`; instant when reduced motion is on. A function
     * target is re-read every frame: the layout can change mid-flight (entering
     * fullscreen on the same tap resizes every `vh` section).
     */
    to(top: number | (() => number)) {
      stop();
      const target = typeof top === "function" ? top : () => top;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        el.scrollTo({ top: target(), behavior: "instant" as ScrollBehavior });
        return;
      }
      const from = el.scrollTop;
      const total = jumpMs(target() - from);
      const t0 = performance.now();
      running = true;
      const step = (now: number) => {
        if (!running) return;
        const elapsed = now - t0;
        if (elapsed >= total) {
          el.scrollTop = target(); // the last frame lands exactly on the target
          running = false;
          raf = 0;
          return;
        }
        el.scrollTop = jumpPosition(from, target(), elapsed);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    active: () => running,
    stop,
    /** Stop and remove the interrupt listeners (unmount). */
    dispose() {
      stop();
      events.forEach((ev) => window.removeEventListener(ev, stop));
    },
  };
}
