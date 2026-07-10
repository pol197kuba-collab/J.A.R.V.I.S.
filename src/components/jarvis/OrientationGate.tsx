import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Smartphone, RotateCw } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Blocks the app on touch devices held in portrait orientation.
 * Only engages on coarse-pointer (touch) devices — desktop/laptop
 * users are never gated regardless of window proportions.
 */
export function OrientationGate({
  children,
  exemptPaths = [],
}: {
  children: ReactNode;
  exemptPaths?: string[];
}) {
  const [blocked, setBlocked] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const portrait = window.matchMedia("(orientation: portrait)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setBlocked(portrait.matches && coarse.matches);
    update();
    portrait.addEventListener("change", update);
    coarse.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      portrait.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const exempt = exemptPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (blocked && !exempt) return <PortraitBlock />;
  return <>{children}</>;
}

function PortraitBlock() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 overflow-hidden bg-black px-6 text-center">
      {/* HUD grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.7 0.2 35 / 0.18) 1px, transparent 1px), linear-gradient(90deg, oklch(0.7 0.2 35 / 0.18) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Scanline */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-scanline h-[2px] w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, oklch(0.78 0.22 40 / 0.85), transparent)",
          }}
        />
      </div>

      {/* Pulsing warning sigil */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span
          className="absolute inset-0 animate-ping rounded-full"
          style={{
            background:
              "radial-gradient(circle, oklch(0.7 0.24 35 / 0.6) 0%, transparent 70%)",
          }}
        />
        <AlertTriangle
          className="relative h-16 w-16 animate-amber-pulse-fast"
          style={{ color: "oklch(0.78 0.22 40)" }}
          strokeWidth={1.5}
        />
      </div>

      {/* Rotating phone */}
      <div className="relative flex items-center justify-center gap-3">
        <div
          className="relative h-16 w-10 rounded-[6px] border-2"
          style={{
            borderColor: "oklch(0.85 0.18 200 / 0.8)",
            boxShadow:
              "0 0 18px oklch(0.85 0.18 200 / 0.6), inset 0 0 8px oklch(0.85 0.18 200 / 0.4)",
            animation: "phone-rotate 2.8s ease-in-out infinite",
            transformOrigin: "center",
          }}
        >
          <span
            className="absolute left-1/2 top-1 h-1 w-3 -translate-x-1/2 rounded-full"
            style={{ background: "oklch(0.85 0.18 200 / 0.7)" }}
          />
          <span
            className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full border"
            style={{ borderColor: "oklch(0.85 0.18 200 / 0.7)" }}
          />
          <Smartphone
            className="absolute inset-0 m-auto h-5 w-5 opacity-60"
            style={{ color: "oklch(0.85 0.18 200)" }}
            strokeWidth={1.5}
          />
        </div>
        <RotateCw
          className="h-6 w-6 animate-spin"
          style={{ color: "oklch(0.85 0.18 200)", animationDuration: "2.8s" }}
          strokeWidth={1.5}
        />
      </div>

      <div className="relative space-y-2">
        <p
          className="font-display text-[11px] uppercase tracking-[0.4em]"
          style={{ color: "oklch(0.78 0.22 40)" }}
        >
          ▲ System Error
        </p>
        <p
          className="font-display text-sm font-bold uppercase tracking-[0.25em]"
          style={{ color: "oklch(0.92 0.18 70)" }}
        >
          Invalid Terminal Resolution
        </p>
        <p className="mx-auto max-w-xs font-display text-[10px] uppercase leading-relaxed tracking-[0.22em] text-primary/80">
          Critical Override: Rotate Device to Landscape to Engage J.A.R.V.I.S.
        </p>
      </div>

      <div className="relative flex items-center gap-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/50">
        <span className="h-1.5 w-1.5 animate-blink rounded-full bg-primary" />
        Awaiting Orientation Lock // 90°
      </div>
    </div>
  );
}