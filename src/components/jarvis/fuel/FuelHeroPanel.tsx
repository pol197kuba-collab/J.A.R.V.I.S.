// Nagłówek modułu: jedna liczba, którą naprawdę się sprawdza — dzisiejsza
// cena hurtowa wybranego paliwa — plus kierunek i skala ruchu.
import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { FuelSeries } from "@/lib/fuel/fuel.functions";
import { cn } from "@/lib/utils";
import { StatTile } from "./chrome";
import { directionColor, formatDatePl, formatPct, formatPln, formatSigned } from "./format";

const COUNT_UP_MS = 700;

/**
 * Liczba „dolicza się" do nowej wartości przy każdej zmianie — to jedyny
 * moment, w którym oko samo łapie, że dane właśnie się odświeżyły.
 * Animacja jest wyłączana przy prefers-reduced-motion.
 */
function useCountUp(target: number | null): number | null {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      fromRef.current = null;
      return;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduced || from === null || from === target) {
      setValue(target);
      fromRef.current = target;
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (target - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target]);

  return value;
}

function DeltaChip({
  label,
  delta,
  pct,
}: {
  label: string;
  delta: number | null;
  pct: number | null;
}) {
  const color = directionColor(delta);
  return (
    <div className="min-w-0 rounded border border-primary/20 px-2.5 py-1">
      <p className="font-display text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xs font-bold" style={{ color }}>
        {formatSigned(delta)} <span className="text-[10px] font-normal">({formatPct(pct)})</span>
      </p>
    </div>
  );
}

export function FuelHeroPanel({
  fuel,
  lastPublished,
}: {
  fuel: FuelSeries | undefined;
  lastPublished: string | null;
}) {
  const stats = fuel?.stats;
  const animated = useCountUp(stats?.latest ?? null);

  const change = stats?.changeDay ?? null;
  const color = directionColor(change);
  const Arrow =
    change === null || change === 0 ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="p-5 @max-[420px]:p-4">
      <p className="font-display text-[10px] uppercase tracking-[0.35em] text-primary/80">
        {fuel?.label ?? "—"}
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Arrow
            className={cn("h-10 w-10 shrink-0 @max-[420px]:h-8 @max-[420px]:w-8")}
            style={{ color, filter: `drop-shadow(0 0 10px ${color})` }}
            strokeWidth={1.5}
            aria-hidden
          />
          <p
            className="font-display text-5xl font-bold tracking-tight tabular-nums @max-[520px]:text-4xl @max-[380px]:text-3xl"
            style={{ textShadow: "var(--glow-primary)" }}
          >
            {animated === null ? "—" : formatPln(animated)}
          </p>
          <span className="font-display self-end pb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            PLN / m³
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <DeltaChip
            label="doba"
            delta={stats?.changeDay ?? null}
            pct={stats?.changeDayPct ?? null}
          />
          <DeltaChip
            label="7 dni"
            delta={stats?.changeWeek ?? null}
            pct={stats?.changeWeekPct ?? null}
          />
          <DeltaChip
            label="30 dni"
            delta={stats?.changeMonth ?? null}
            pct={stats?.changeMonthPct ?? null}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-3">
        <StatTile
          label="min 52 tyg."
          value={formatPln(stats?.low52w ?? null)}
          unit="PLN/m³"
          color="var(--success)"
        />
        <StatTile
          label="max 52 tyg."
          value={formatPln(stats?.high52w ?? null)}
          unit="PLN/m³"
          color="var(--destructive)"
        />
        <StatTile
          label="pozycja w paśmie"
          value={
            stats?.position52w === null || stats?.position52w === undefined
              ? "—"
              : `${stats.position52w}`
          }
          unit="%"
          hint="0 = roczne minimum"
        />
        <StatTile
          label="zmienność 30d"
          value={formatPln(stats?.volatility30d ?? null, 1)}
          unit="PLN/m³"
          hint="odch. std. zmian dziennych"
        />
      </div>

      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
        Ostatnia publikacja cennika:{" "}
        <span className="text-foreground/80">
          {lastPublished ? formatDatePl(lastPublished) : "—"}
        </span>
        {stats?.latestDate && stats.latestDate !== lastPublished && (
          <> · seria domknięta do {formatDatePl(stats.latestDate)}</>
        )}
      </p>
    </div>
  );
}
