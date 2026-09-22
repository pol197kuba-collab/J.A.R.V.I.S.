import { useEffect, useRef, useState } from "react";

/**
 * How much of the top bar's chrome fits at its CURRENT rendered width.
 *
 * Measured, not inferred from the viewport: the bar's available width also
 * changes when the rail collapses or expands, so `portrait:`/`landscape:`
 * variants (which only see the device) would keep the full cluster mounted
 * in a 1280px window where it demonstrably does not fit — that is exactly
 * how the labels ended up wrapping onto two lines. Container queries can't
 * do it either, because the decision is *which element renders where*, not
 * just how it is styled.
 *
 *  - "full"    — every action on the bar, status spelled out
 *  - "medium"  — every action on the bar, status collapses to its dot
 *  - "compact" — only voice + notifications stay; the rest move behind SYS
 */
export type HeaderDensity = "full" | "medium" | "compact";

const MEDIUM_BELOW = 1320;
const COMPACT_BELOW = 1150;

function densityFor(width: number): HeaderDensity {
  if (width < COMPACT_BELOW) return "compact";
  if (width < MEDIUM_BELOW) return "medium";
  return "full";
}

export function useHeaderDensity<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Start compact: on the first paint the width is unknown, and briefly
  // under-filling the bar is invisible, whereas briefly over-filling it
  // shows the wrapped-label flash this hook exists to prevent.
  const [density, setDensity] = useState<HeaderDensity>("compact");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") {
      setDensity("full");
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setDensity(densityFor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, density };
}
