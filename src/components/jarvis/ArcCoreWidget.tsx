import { ReactorCore } from "./ReactorCore";

/**
 * Compact, always-visible Arc Core status widget pinned to the
 * bottom-left of the viewport. Reuses the full ReactorCore animation
 * (drag-to-rotate + pinch zoom still active) at a much smaller size.
 */
export function ArcCoreWidget() {
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-30 hidden md:block"
      aria-label="Arc Core status"
    >
      <div className="pointer-events-auto relative w-[260px] border border-primary/40 bg-black/60 backdrop-blur-sm shadow-[0_0_20px_rgba(56,189,248,0.15)]">
        {/* Corner label */}
        <div className="flex items-center justify-between border-b border-primary/30 bg-black/40 px-2 py-1 font-display text-[9px] uppercase tracking-[0.28em] text-primary/80">
          <span>ARC CORE // J-3140</span>
          <span className="flex items-center gap-1 text-primary">
            <span
              className="h-1.5 w-1.5 animate-blink rounded-full"
              style={{ backgroundColor: "var(--primary)" }}
            />
            LIVE
          </span>
        </div>
        <div className="px-3 py-2">
          <ReactorCore />
        </div>
      </div>
    </div>
  );
}