import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity } from "lucide-react";
import { listSystemEvents, type SystemEvent } from "@/lib/system/events.functions";

// Plain absolutely-positioned HTML chrome laid OVER the <JarvisCanvas>
// (sibling in the DOM, not inside the R3F tree) — title, node-count readout,
// the "recent network assignments" log feed and the bottom status bar. The
// per-node hover/task-preview cards live inside AgentNode3D itself (drei
// <Html>, anchored to each node's 3D position) since those need to track
// the satellite as the camera orbits; this layer only holds chrome that's
// fixed to the viewport.
const LEVEL_COLOR: Record<SystemEvent["level"], string> = {
  info: "#4dd8ff",
  debug: "#8892a6",
  warn: "#f5b942",
  error: "#ff4d4d",
};

function formatSource(source: string): string {
  if (source.startsWith("tool.")) return `TOOL·${source.slice(5).toUpperCase()}`;
  return source.toUpperCase();
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

export function HudOverlay({
  agentCount,
  onlineCount,
}: {
  agentCount: number;
  onlineCount: number;
}) {
  const fetchEvents = useServerFn(listSystemEvents);
  const { data: events = [] } = useQuery({
    queryKey: ["system-events", "jarvis-matrix"],
    queryFn: () => fetchEvents({ data: { limit: 12 } }),
    refetchInterval: 4000,
  });

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col p-4 sm:p-6">
      {/* Title bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-base font-bold uppercase tracking-[0.3em] text-cyan-300/90 [text-shadow:0_0_16px_rgba(77,216,255,0.6)] sm:text-lg">
            J.A.R.V.I.S. // STARK AGENT MATRIX
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            {onlineCount} / {agentCount} nodes online · live delegation network
          </p>
        </div>
      </div>

      {/* Right log panel */}
      <div className="pointer-events-auto absolute right-4 top-16 flex max-h-[50%] w-[220px] flex-col overflow-hidden rounded-lg border border-cyan-400/25 bg-black/60 shadow-[0_0_30px_-10px_rgba(77,216,255,0.5)] backdrop-blur-md sm:right-6 sm:top-20 sm:w-[260px]">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-cyan-400/20 px-3 py-2">
          <Activity className="h-3 w-3 text-cyan-300" strokeWidth={1.5} />
          <span className="font-display text-[9px] uppercase tracking-[0.25em] text-cyan-300/90">
            Recent Network Assignments
          </span>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {events.length === 0 ? (
            <p className="px-1 py-2 font-mono text-[9px] uppercase tracking-widest text-white/30">
              ▸ awaiting activity…
            </p>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="border-l-2 pl-2"
                style={{ borderColor: LEVEL_COLOR[e.level] }}
              >
                <p className="font-mono text-[8px] text-white/40">
                  {timeOf(e.createdAt)} · {formatSource(e.source)}
                </p>
                <p className="line-clamp-2 font-mono text-[10px] leading-snug text-white/85">
                  {e.message}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="pointer-events-auto mt-auto flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/15 bg-black/40 px-4 py-2 backdrop-blur-sm">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
          drag to orbit · scroll to zoom · click a node for details
        </span>
        <span className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.25em] text-cyan-300/90">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_6px_#4dd8ff]" />
          matrix live
        </span>
      </div>
    </div>
  );
}
