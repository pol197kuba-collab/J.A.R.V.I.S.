export function MiniArcReactor({ size = 28 }: { size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full text-primary animate-mini-reactor-spin"
        style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.4"
        />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeDasharray="2 3"
          opacity="0.7"
        />
        {[0, 120, 240].map((rot) => (
          <g
            key={rot}
            transform={`rotate(${rot} 50 50)`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          >
            <polygon points="50,18 70,55 30,55" />
          </g>
        ))}
      </svg>
      <div
        className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary animate-pulse-core"
        style={{ boxShadow: "var(--glow-primary)" }}
      />
    </div>
  );
}
