// Wspólne komponenty modułu paliwowego: kafel statystyki, chipy zakresu
// i tooltip wykresu (formatery mieszkają obok, w format.ts). Tooltip i kafel
// są bliskimi krewnymi tych ze SystemPulsePanel.tsx — ten sam język wizualny
// HUD-a, tylko z jednostkami i kolorem serii, których tamten nie potrzebował.
import { type ReactNode } from "react";
import { type TooltipProps } from "recharts";
import { cn } from "@/lib/utils";
import { formatPln } from "./format";

export function LiveDot({ active, label = "LIVE" }: { active: boolean; label?: string }) {
  return (
    <span className="font-display flex items-center gap-1.5 text-[10px] uppercase tracking-[0.3em] text-primary">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-[color:var(--success)]",
          active && "animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

export function StatTile({
  label,
  value,
  unit,
  color,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 border-l border-primary/15 pl-3 first:border-l-0 first:pl-0">
      <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </p>
      <p
        className="font-display mt-1 truncate text-2xl font-bold tracking-wide @max-[420px]:text-xl"
        style={{ color: color ?? "var(--foreground)" }}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </p>
      {hint && (
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex overflow-hidden rounded border border-primary/25"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "font-display px-2.5 py-1 text-[9px] uppercase tracking-widest transition",
            value === option.value
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:bg-primary/10",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type ChartRow = { label: string } & Record<string, unknown>;

/**
 * Tooltip krzyżowy dla wykresów liniowych: pokazuje wszystkie serie dla
 * najechanego dnia, każdą z jej kolorem, wartością i jednostką.
 */
export function SeriesTooltip({
  active,
  payload,
  label,
  unit,
  fractionDigits = 0,
}: TooltipProps<number, string> & { unit?: string; fractionDigits?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pointer-events-none rounded border border-primary/30 bg-popover px-2.5 py-1.5 shadow-lg">
      <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
        {String(label)}
      </p>
      <div className="mt-1 space-y-0.5">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="font-display text-[9px] uppercase tracking-wider text-muted-foreground">
              {entry.name}
            </span>
            <span className="ml-auto font-mono text-[11px] font-bold text-foreground">
              {formatPln(entry.value as number, fractionDigits)}
              {unit && <span className="ml-1 text-[9px] text-muted-foreground">{unit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelHint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 min-w-0 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center">
      <p className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
