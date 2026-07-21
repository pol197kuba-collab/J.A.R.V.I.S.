import { useMemo } from "react";

const PREFIXES = ["SYS_REF", "CH", "NODE", "SEG", "TRX", "REG"];
const HEX = "0123456789ABCDEF";

function rand(seed: number) {
  // deterministic xorshift
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function makeTag(seed: number) {
  const r = rand(seed);
  const prefix = PREFIXES[Math.floor(r() * PREFIXES.length)];
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += HEX[Math.floor(r() * 16)];
  const tail = Math.floor(r() * 900 + 100);
  return `${prefix}:${suffix}-${tail}`;
}

export function HudTag({
  seed = 1,
  corner = "tr",
  className = "",
}: {
  seed?: number;
  corner?: "tl" | "tr" | "bl" | "br";
  className?: string;
}) {
  const text = useMemo(() => makeTag(seed), [seed]);
  const pos: Record<string, string> = {
    tl: "top-1 left-2",
    tr: "top-1 right-2",
    bl: "bottom-1 left-2",
    br: "bottom-1 right-2",
  };
  return (
    <span
      className={`pointer-events-none absolute ${pos[corner]} font-display text-[8px] tracking-[0.25em] text-primary/60 ${className}`}
    >
      {text}
    </span>
  );
}
