// Vision AR (S4.3) — boxes over the live video. The video is object-fit:
// cover, so boxes go through coverRect (live.ts) to land on the right
// pixels; the layer takes the same digital-zoom transform as the video.
// Tapping a box asks what exactly it is (onPick).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { coverRect, type Detection } from "@/lib/vision/live";

export function LiveOverlay({
  detections,
  frame,
  style,
  onPick,
  picking,
}: {
  detections: readonly Detection[];
  frame: { w: number; h: number } | null;
  style?: CSSProperties;
  onPick: (d: Detection) => void;
  picking: Detection | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setView({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10" style={style}>
      {frame &&
        detections.map((d, i) => {
          const r = coverRect(d, frame.w, frame.h, view.w, view.h);
          if (!r) return null;
          const active = picking === d;
          return (
            <button
              key={`${d.label}-${i}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => onPick(d)}
              aria-label={`Co to jest: ${d.label}`}
              className="pointer-events-auto absolute transition-[left,top,width,height] duration-300"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                border: `1.5px solid ${active ? "var(--reactor)" : "var(--primary)"}`,
                boxShadow: active
                  ? "var(--glow-primary)"
                  : "0 0 8px color-mix(in oklab, var(--primary) 45%, transparent)",
                background: active
                  ? "color-mix(in oklab, var(--primary) 12%, transparent)"
                  : "transparent",
              }}
            >
              <span
                className="font-display absolute left-0 top-0 max-w-full -translate-y-full truncate px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em] text-background"
                style={{ background: active ? "var(--reactor)" : "var(--primary)" }}
              >
                {d.label}
              </span>
            </button>
          );
        })}
    </div>
  );
}
