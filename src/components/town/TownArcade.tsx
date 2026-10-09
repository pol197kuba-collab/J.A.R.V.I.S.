import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import {
  markerSpeed,
  readArcadeBest as loadBest,
  writeArcadeBest as saveBest,
  zoneWidth,
} from "./townPropActions";

type Phase = "ready" | "play" | "over";

/**
 * "Złap buga" — the arcade cabinet's mini-game. A cursor sweeps across a
 * bar; hit Space / E / Enter (or the button) while it's over the bug. Each
 * catch narrows the bug and speeds the cursor up; one miss ends the round.
 */
export function TownArcade({ onExit }: { onExit: (score: number) => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => loadBest());
  const [zone, setZone] = useState({ at: 0.6, w: zoneWidth(0) });
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const dirRef = useRef(1);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      let p = posRef.current + dirRef.current * markerSpeed(score) * dt;
      if (p > 1) {
        p = 2 - p;
        dirRef.current = -1;
      } else if (p < 0) {
        p = -p;
        dirRef.current = 1;
      }
      posRef.current = p;
      setPos(p);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, score]);

  const newZone = (s: number) => {
    const w = zoneWidth(s);
    setZone({ at: w / 2 + Math.random() * (1 - w), w });
  };

  const act = useCallback(() => {
    if (phase !== "play") {
      setScore(0);
      posRef.current = 0;
      dirRef.current = 1;
      newZone(0);
      setPhase("play");
      return;
    }
    const hit = Math.abs(posRef.current - zone.at) <= zone.w / 2;
    if (hit) {
      const next = score + 1;
      setScore(next);
      newZone(next);
      return;
    }
    setPhase("over");
    if (score > best) {
      setBest(score);
      saveBest(score);
    }
  }, [phase, score, zone, best]);

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === " " || e.key === "Enter" || e.key === "e" || e.key === "E") {
      e.preventDefault();
      act();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onExit(score);
    }
  };

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      onKeyDown={onKey}
      className="mt-2 grid gap-2 focus:outline-none"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          Wynik: <b className="tabular-nums text-primary">{score}</b>
        </span>
        <span className="text-xs text-muted-foreground">Rekord: {best}</span>
      </div>
      <div className="relative h-6 border-2 border-border bg-background" aria-hidden>
        <div
          className="absolute inset-y-0 bg-success/70"
          style={{ left: `${(zone.at - zone.w / 2) * 100}%`, width: `${zone.w * 100}%` }}
        />
        <div
          className="absolute inset-y-[-4px] w-1 bg-primary"
          style={{ left: `calc(${pos * 100}% - 2px)` }}
        />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {phase === "ready" && "Spacja, E albo przycisk, gdy kursor jest nad zielonym bugiem."}
        {phase === "play" && "Łap!"}
        {phase === "over" &&
          (score > 0 && score >= best
            ? `Nowy rekord: ${score}!`
            : `Koniec gry. Złapane bugi: ${score}.`)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={act}
          className={cn(
            "font-display rounded-md border px-3 py-1.5 text-xs",
            "border-primary bg-primary text-primary-foreground",
          )}
        >
          {phase === "play" ? "Teraz!" : phase === "over" ? "Jeszcze raz" : "Start"}
        </button>
        <button
          type="button"
          onClick={() => onExit(score)}
          className="font-display rounded-md border border-border px-3 py-1.5 text-xs text-foreground"
        >
          Wyjdź
        </button>
      </div>
    </div>
  );
}
