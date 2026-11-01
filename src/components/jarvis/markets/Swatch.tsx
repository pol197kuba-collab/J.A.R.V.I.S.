// Kreska gracza funduszu: kolor = tożsamość, przerywana = odniesienie.

export function Swatch({ color, dashed }: { color: string; dashed: boolean }) {
  return (
    <svg width="18" height="8" className="shrink-0" aria-hidden>
      <line
        x1="1"
        y1="4"
        x2="17"
        y2="4"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dashed ? "4 3" : undefined}
        style={{ stroke: color }}
      />
    </svg>
  );
}
