import { useEffect, useState, type RefObject } from "react";

/**
 * Mobile browsers (Chrome on Android since 108, Safari) open the on-screen
 * keyboard OVER the page: the layout viewport — and every `fixed inset-0` /
 * `100dvh` box — keeps its full height, so the lower half of a fixed screen
 * (here: the login fields) ends up under the keyboard and cannot be scrolled to.
 *
 * This hook follows `window.visualViewport` (the part actually visible) and
 * returns the top/height to give the fixed container while the keyboard is up,
 * then brings the focused field into view inside it. Null when nothing needs
 * changing (no keyboard, desktop, or no visualViewport support).
 */
export function useKeyboardSafeViewport(rootRef: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // a keyboard (or anything) covers more than ~15% of the layout viewport
        const covered = window.innerHeight - vv.height > window.innerHeight * 0.15;
        setBox(covered ? { top: vv.offsetTop, height: vv.height } : null);
        const active = document.activeElement as HTMLElement | null;
        if (covered && active && rootRef.current?.contains(active)) {
          // after the container has been resized to the visible area
          requestAnimationFrame(() => active.scrollIntoView({ block: "center" }));
        }
      });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [rootRef]);

  return box;
}
