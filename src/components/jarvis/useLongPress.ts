import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

/**
 * Tap vs long press on one button. A hold of `ms` fires `onHold` (the click that
 * follows is swallowed); releasing earlier — without sliding away — is a tap.
 */
export function useLongPress(ms: number, onTap: () => void, onHold: () => void) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    holding,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        setHolding(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          fired.current = true;
          start.current = null;
          setHolding(false);
          onHold();
        }, ms);
      },
      onPointerMove: (e: PointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 14) cancel();
      },
      onPointerUp: () => {
        if (start.current) cancel();
      },
      onPointerCancel: cancel,
      onPointerLeave: () => {
        if (start.current) cancel();
      },
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
      onClick: () => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onTap();
      },
    },
  };
}
