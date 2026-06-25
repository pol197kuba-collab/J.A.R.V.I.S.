import { cn } from "@/lib/utils";

export function ArcReactorTriangle({ className, raised }: { className?: string; raised?: boolean }) {
  return (
    <div
      className={cn(
        "relative aspect-square w-[min(48vmin,360px)] transition-all duration-700 ease-out",
        raised && "-translate-y-16 scale-75",
        className,
      )}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full text-primary animate-triangle-pulse">
        <defs>
          <radialGradient id="arc-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.98 0.05 215)" stopOpacity="1" />
            <stop offset="35%" stopColor="oklch(0.85 0.18 215)" stopOpacity="0.95" />
            <stop offset="70%" stopColor="oklch(0.6 0.2 230)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="oklch(0.3 0.1 240)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
        <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.6" />
        <circle cx="100" cy="100" r="68" fill="url(#arc-core)" />
        {/* Triangular reactor segments */}
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
        >
          {[0, 120, 240].map((rot) => (
            <g key={rot} transform={`rotate(${rot} 100 100)`}>
              <polygon points="100,46 130,98 70,98" />
              <polygon points="100,58 122,96 78,96" opacity="0.6" />
              <line x1="100" y1="46" x2="100" y2="30" />
            </g>
          ))}
        </g>
        <circle cx="100" cy="100" r="14" fill="oklch(0.98 0.04 215)" />
        <circle cx="100" cy="100" r="6" fill="white" />
      </svg>
    </div>
  );
}