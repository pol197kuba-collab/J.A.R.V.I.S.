import { useEffect, useRef, useState } from "react";

/**
 * True while the user is actively scrolling anywhere on the page, flipping
 * back to false once scrolling has been idle for `idleMs`.
 *
 * Listens in the CAPTURE phase on `document` rather than on `window`,
 * because scroll events do not bubble: a capture listener is the one way to
 * catch both the document's own scroll and an inner scroller's (the shell's
 * <main> scrolls itself in the orientations where the root gets a definite
 * height, and the document scrolls in every other case). Binding to
 * `window` alone would silently miss half of them.
 */
export function useIsScrolling(idleMs = 600) {
  const [scrolling, setScrolling] = useState(false);
  // Mirrors `scrolling` so the high-frequency scroll handler can early-out
  // without a state read — otherwise every scroll event would queue a
  // re-render for a value that is already true.
  const activeRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: number | null = null;

    const onScroll = () => {
      if (!activeRef.current) {
        activeRef.current = true;
        setScrolling(true);
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        activeRef.current = false;
        setScrolling(false);
        timer = null;
      }, idleMs);
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [idleMs]);

  return scrolling;
}
