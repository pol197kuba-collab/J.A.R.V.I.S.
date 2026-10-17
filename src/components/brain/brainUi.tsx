// Mózg 3D — drobne elementy UI wspólne dla trybów WIEDZA i STRUKTURA.

import type { ReactNode } from "react";
import { Boxes, Database, List, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrainKind, Mode } from "./hooks";

function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; icon: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "pointer-events-auto flex shrink-0 overflow-hidden rounded-lg border border-primary/25 bg-black/60 backdrop-blur-md",
        className,
      )}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "flex h-full flex-1 items-center justify-center gap-1.5 px-3 font-display text-[10px] uppercase tracking-widest transition-colors",
            value === it.id ? "bg-primary/20 text-primary" : "text-muted-foreground",
          )}
        >
          {it.icon}
          <span className="@max-[380px]:sr-only">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Widok 3D / LISTA. */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <Segmented
      label="Widok"
      value={mode}
      onChange={onChange}
      className="h-11 @min-[640px]:h-10"
      items={[
        { id: "3d", label: "3D", icon: <Boxes className="h-4 w-4" /> },
        { id: "list", label: "Lista", icon: <List className="h-4 w-4" /> },
      ]}
    />
  );
}

/** Tryb WIEDZA / STRUKTURA — pierwszy wiersz nakładki w obu trybach. */
export function KindSwitch({
  kind,
  onChange,
}: {
  kind: BrainKind;
  onChange: (k: BrainKind) => void;
}) {
  return (
    <Segmented
      label="Tryb Mózgu"
      value={kind}
      onChange={onChange}
      className="h-9 w-full @min-[640px]:w-auto @min-[640px]:self-start"
      items={[
        { id: "knowledge", label: "Wiedza", icon: <Sparkles className="h-3.5 w-3.5" /> },
        { id: "structure", label: "Struktura", icon: <Database className="h-3.5 w-3.5" /> },
      ]}
    />
  );
}

export function CenterNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <p className="flex max-w-sm items-center gap-2 text-center font-mono text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span>{children}</span>
      </p>
    </div>
  );
}
