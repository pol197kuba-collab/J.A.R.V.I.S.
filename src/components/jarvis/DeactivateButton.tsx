import { Power } from "lucide-react";

export function DeactivateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-display group relative flex items-center gap-2 border px-3 py-1.5 text-[10px] uppercase tracking-[0.3em] transition"
      style={{
        color: "var(--destructive)",
        borderColor: "color-mix(in oklab, var(--destructive) 60%, transparent)",
        backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)",
        boxShadow: "0 0 16px color-mix(in oklab, var(--destructive) 40%, transparent)",
      }}
    >
      <span className="absolute -left-px -top-px h-1.5 w-1.5 border-l border-t" style={{ borderColor: "var(--destructive)" }} />
      <span className="absolute -right-px -top-px h-1.5 w-1.5 border-r border-t" style={{ borderColor: "var(--destructive)" }} />
      <span className="absolute -left-px -bottom-px h-1.5 w-1.5 border-l border-b" style={{ borderColor: "var(--destructive)" }} />
      <span className="absolute -right-px -bottom-px h-1.5 w-1.5 border-r border-b" style={{ borderColor: "var(--destructive)" }} />
      <Power strokeWidth={1.5} className="h-3 w-3" />
      Deactivate JARVIS
    </button>
  );
}