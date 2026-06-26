import { useMemo, useState } from "react";
import { HudPanel } from "./HudPanel";
import { COMMAND_DIRECTORY, type CommandCategory } from "@/data/commandDirectory";

const CATEGORY_COLOR: Record<CommandCategory, string> = {
  Navigation: "var(--primary)",
  Interface: "var(--accent, var(--primary))",
  System: "var(--destructive, #ff5577)",
};

export function CommandDirectory({ index = 99 }: { index?: number }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return COMMAND_DIRECTORY;
    return COMMAND_DIRECTORY.filter((c) =>
      [c.action, c.label, c.description, ...c.phrases]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [q]);

  return (
    <HudPanel index={index} title="JARVIS COMMAND DIRECTORY" className="p-5">
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-3 border border-primary/40 bg-black/40 px-3 py-2">
          <span className="font-display text-[10px] uppercase tracking-widest text-primary/80">
            FILTER COMMANDS //
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="action / phrase / description"
            spellCheck={false}
            className="font-mono flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {filtered.length}/{COMMAND_DIRECTORY.length}
          </span>
        </div>

        <div className="overflow-x-auto border border-primary/20">
          <table className="min-w-full border-collapse font-mono text-[11px]">
            <thead className="bg-primary/10 text-primary">
              <tr className="text-left uppercase tracking-widest">
                <th className="border-b border-primary/40 px-3 py-2">Action</th>
                <th className="border-b border-primary/40 px-3 py-2">Label</th>
                <th className="border-b border-primary/40 px-3 py-2">Example Phrases</th>
                <th className="border-b border-primary/40 px-3 py-2">Description</th>
                <th className="border-b border-primary/40 px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.action}
                  className="border-b border-primary/10 align-top hover:bg-primary/5"
                >
                  <td className="px-3 py-2">
                    <code className="border border-primary/40 bg-black/60 px-1.5 py-0.5 text-primary">
                      {c.action}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-foreground">{c.label}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.phrases.map((p) => (
                        <span
                          key={p}
                          className="border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary/90"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.description}</td>
                  <td className="px-3 py-2">
                    <span
                      className="font-display text-[10px] uppercase tracking-widest"
                      style={{ color: CATEGORY_COLOR[c.category] }}
                    >
                      ◢ {c.category}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    NO MATCH // ADJUST QUERY
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </HudPanel>
  );
}