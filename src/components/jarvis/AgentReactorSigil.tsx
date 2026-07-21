import { useMemo } from "react";
import { cn } from "@/lib/utils";

function hashSlug(slug: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic reactor sigil — each agent slug generates a unique variant.
// Cosmetic only: hue shift, ring count, segment count, rotation speed.
export function AgentReactorSigil({
  slug,
  size = 220,
  className,
  active = true,
}: {
  slug: string;
  size?: number;
  className?: string;
  active?: boolean;
}) {
  const variant = useMemo(() => {
    const h = hashSlug(slug || "agent");
    const hue = h % 360;
    // Keep close to the JARVIS cyan palette by biasing hue into 180–260.
    const hueBiased = 180 + (h % 80);
    const segments = 3 + (h % 4); // 3–6
    const orbitalRings = 2 + ((h >>> 3) % 3); // 2–4
    const spinSec = 24 + ((h >>> 6) % 20); // 24–43s
    const counter = (h >>> 4) & 1;
    return { hue, hueBiased, segments, orbitalRings, spinSec, counter };
  }, [slug]);

  const accent = `oklch(0.85 0.18 ${variant.hueBiased})`;
  const accentDim = `oklch(0.55 0.14 ${variant.hueBiased})`;
  const glowShadow = `drop-shadow(0 0 12px oklch(0.75 0.2 ${variant.hueBiased} / 0.6))`;

  const segmentAngle = 360 / variant.segments;
  const orbitals = Array.from({ length: variant.orbitalRings }, (_, i) => i);

  return (
    <div
      className={cn("relative", className)}
      style={{ width: size, height: size, filter: active ? glowShadow : undefined }}
      aria-hidden
    >
      {/* Outer counter-rotating orbitals */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id={`sigil-core-${slug}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.98 0.06 215)" stopOpacity="1" />
            <stop offset="40%" stopColor={accent} stopOpacity="0.9" />
            <stop offset="75%" stopColor={accentDim} stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.25 0.08 240)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {orbitals.map((i) => {
          const r = 96 - i * 10;
          const dash = i % 2 === 0 ? "3 5" : "2 8";
          return (
            <circle
              key={i}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={accentDim}
              strokeWidth="0.6"
              strokeDasharray={dash}
              opacity={0.6 - i * 0.1}
            />
          );
        })}
        <circle cx="100" cy="100" r="66" fill={`url(#sigil-core-${slug})`} />
      </svg>
      {/* Rotating segment ring */}
      <svg
        viewBox="0 0 200 200"
        className={cn(
          "absolute inset-0 h-full w-full",
          active && (variant.counter ? "animate-sigil-spin-rev" : "animate-sigil-spin"),
        )}
        style={{ animationDuration: `${variant.spinSec}s` }}
      >
        <g
          fill="none"
          stroke={accent}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {Array.from({ length: variant.segments }, (_, i) => (
            <g key={i} transform={`rotate(${i * segmentAngle} 100 100)`}>
              <polygon points="100,42 128,96 72,96" opacity="0.9" />
              <polygon points="100,54 120,94 80,94" opacity="0.5" />
              <line x1="100" y1="42" x2="100" y2="26" opacity="0.7" />
            </g>
          ))}
        </g>
      </svg>
      {/* Core */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <circle cx="100" cy="100" r="16" fill="oklch(0.98 0.04 215)" opacity="0.95" />
        <circle cx="100" cy="100" r="7" fill="white" />
      </svg>
    </div>
  );
}
