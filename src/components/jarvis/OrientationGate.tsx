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

  const exempt = exemptPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));

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
            "linear-gradient(color-mix(in oklab, color-mix(in oklab, var(--destructive) 60%, var(--reactor)) 18%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, color-mix(in oklab, var(--destructive) 60%, var(--reactor)) 18%, transparent) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Scanline */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-scanline h-[2px] w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in oklab, color-mix(in oklab, var(--destructive) 50%, var(--reactor)) 85%, transparent), transparent)",
          }}
        />
      </div>

      {/* Pulsing warning sigil */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span
          className="absolute inset-0 animate-ping rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, color-mix(in oklab, var(--destructive) 60%, var(--reactor)) 60%, transparent) 0%, transparent 70%)",
          }}
        />
        <AlertTriangle
          className="relative h-16 w-16 animate-amber-pulse-fast"
          style={{ color: "color-mix(in oklab, var(--destructive) 50%, var(--reactor))" }}
          strokeWidth={1.5}
        />
      </div>

      {/* Rotating phone */}
      <div className="relative flex items-center justify-center gap-3">
        <div
          className="relative h-16 w-10 rounded-[6px] border-2"
          style={{
            borderColor: "color-mix(in oklab, var(--primary) 80%, transparent)",
            boxShadow:
              "0 0 18px color-mix(in oklab, var(--primary) 60%, transparent), inset 0 0 8px color-mix(in oklab, var(--primary) 40%, transparent)",
            animation: "phone-rotate 2.8s ease-in-out infinite",
            transformOrigin: "center",
          }}
        >
          <span
            className="absolute left-1/2 top-1 h-1 w-3 -translate-x-1/2 rounded-full"
            style={{ background: "color-mix(in oklab, var(--primary) 70%, transparent)" }}
          />
          <span
            className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full border"
            style={{ borderColor: "color-mix(in oklab, var(--primary) 70%, transparent)" }}
          />
          <Smartphone
            className="absolute inset-0 m-auto h-5 w-5 opacity-60"
            style={{ color: "var(--primary)" }}
            strokeWidth={1.5}
          />
        </div>
        <RotateCw
          className="h-6 w-6 animate-spin"
          style={{ color: "var(--primary)", animationDuration: "2.8s" }}
          strokeWidth={1.5}
        />
      </div>

      <div className="relative space-y-2">
        <p
          className="font-display text-[11px] uppercase tracking-[0.4em]"
          style={{ color: "color-mix(in oklab, var(--destructive) 50%, var(--reactor))" }}
        >
          ▲ System Error
        </p>
        <p
          className="font-display text-sm font-bold uppercase tracking-[0.25em]"
          style={{ color: "var(--reactor-hot)" }}
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
