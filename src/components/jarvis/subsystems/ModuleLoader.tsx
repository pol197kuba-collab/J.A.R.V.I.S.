import { useEffect, useRef, useState } from "react";
import type { SubSystem } from "@/data/subSystems";
import { audio } from "@/lib/audio/AudioEngine";

const STEPS = [8, 23, 41, 58, 72, 88, 96, 100];

function buildLogLines(mod: SubSystem) {
  return [
    "[OK] INITIATING HANDSHAKE...",
    `[OK] RESOLVING ${mod.codename}...`,
    "[OK] NEGOTIATING TLS 1.3 CIPHER SUITE",
    "[OK] BYPASSING PERIMETER FIREWALL",
    `[OK] CONNECTING TO ${mod.codename}`,
    "[OK] EXCHANGING SESSION KEYS",
    "[OK] STARK_SECURE_TUNNEL: ACTIVE",
    "[OK] MOUNTING REMOTE DOM...",
    "[OK] HANDOFF COMPLETE.",
  ];
}

export function ModuleLoader({
  mod,
  onReady,
}: {
  mod: SubSystem;
  onReady: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [iris, setIris] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    audio.playEngage();
    const allLogs = buildLogLines(mod);
    const total = 4500;
    const stepInterval = total / STEPS.length;
    const timers: ReturnType<typeof setTimeout>[] = [];

    STEPS.forEach((p, i) => {
      timers.push(
        setTimeout(() => {
          setProgress(p);
          setLogs((cur) => [...cur, allLogs[i] ?? allLogs[allLogs.length - 1]]);
          audio.playClick();
          if (p >= 100 && !ready.current) {
            ready.current = true;
            audio.playAccessGranted();
            setTimeout(() => setIris(true), 250);
            setTimeout(() => onReady(), 900);
          }
        }, stepInterval * (i + 1)),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [mod, onReady]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-black">
      {/* grid backdrop */}
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-20" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)",
        }}
      />

      {/* central radar */}
      <div className="relative h-72 w-72">
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
          <g
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="0.6"
            opacity="0.7"
          >
            <circle cx="100" cy="100" r="92" />
            <circle cx="100" cy="100" r="70" strokeDasharray="2 4" />
            <circle cx="100" cy="100" r="48" strokeDasharray="1 3" />
            <circle cx="100" cy="100" r="20" />
            <line x1="8" y1="100" x2="192" y2="100" strokeDasharray="2 6" />
            <line x1="100" y1="8" x2="100" y2="192" strokeDasharray="2 6" />
          </g>
          {/* ticks */}
          <g stroke="currentColor" className="text-primary" strokeWidth="0.8" opacity="0.8">
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const x1 = 100 + Math.cos(a) * 92;
              const y1 = 100 + Math.sin(a) * 92;
              const x2 = 100 + Math.cos(a) * (i % 6 === 0 ? 82 : 87);
              const y2 = 100 + Math.sin(a) * (i % 6 === 0 ? 82 : 87);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
          </g>
        </svg>

        {/* sweep beam */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--primary) 55%, transparent) 30deg, transparent 60deg)",
            mixBlendMode: "screen",
            animation: "radar-sweep 2.4s linear infinite",
            maskImage: "radial-gradient(circle, black 60%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(circle, black 60%, transparent 70%)",
          }}
          aria-hidden
        />

        {/* counter-spin inner ring */}
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-0 h-full w-full text-primary spin-ccw-12"
        >
          <g fill="none" stroke="currentColor" strokeWidth="0.8">
            <circle cx="100" cy="100" r="34" strokeDasharray="6 8" />
            <circle cx="100" cy="100" r="10" />
          </g>
        </svg>

        {/* center label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-[9px] uppercase tracking-[0.35em] text-primary/90 animate-hud-flicker">
            {mod.codename}
          </span>
        </div>
      </div>

      {/* caption */}
      <p className="mt-6 font-display text-xs uppercase tracking-[0.4em] text-primary animate-hud-flicker">
        Decrypting Link // External_Server_Connect
      </p>

      {/* progress + logs */}
      <div className="mt-8 grid w-[min(880px,92vw)] gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="hud-panel p-4">
          <span className="hud-corner tl" />
          <span className="hud-corner tr" />
          <span className="hud-corner bl" />
          <span className="hud-corner br" />
          <div className="mb-2 flex justify-between font-display text-[10px] uppercase tracking-[0.3em] text-primary/80">
            <span>Tunnel Negotiation</span>
            <span>{progress.toString().padStart(3, "0")}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden border border-primary/40 bg-black">
            <div
              className="h-full transition-[width] duration-200"
              style={{
                width: `${progress}%`,
                background:
                  "linear-gradient(90deg, color-mix(in oklab, var(--primary) 35%, transparent), var(--primary))",
                boxShadow: "0 0 12px var(--primary)",
              }}
            />
          </div>
        </div>

        <div className="hud-panel max-h-44 overflow-hidden p-3">
          <span className="hud-corner tl" />
          <span className="hud-corner tr" />
          <span className="hud-corner bl" />
          <span className="hud-corner br" />
          <div className="space-y-1 font-mono text-[10px] leading-relaxed text-primary/85">
            {logs.map((line, i) => (
              <div
                key={i}
                className="whitespace-nowrap"
                style={{ animation: "log-line-in .3s ease-out both" }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* iris-open overlay */}
      {iris && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div
            className="h-6 w-6 rounded-full bg-primary animate-iris-open"
            style={{ boxShadow: "0 0 60px var(--primary), 0 0 120px var(--primary)" }}
          />
        </div>
      )}
    </div>
  );
}