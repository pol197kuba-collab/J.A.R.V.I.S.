import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { HudPanel } from "./HudPanel";
import { askJarvis, hasGeminiKey } from "@/lib/ai/jarvisBrain";

type Dispatch = { id: string; time: string; text: string };

const STORAGE_KEY = "jarvis_intel_feed";
const STORAGE_TS_KEY = "jarvis_intel_feed_ts";
const MIN_REFRESH_MS = 5 * 60 * 1000;
// Module-level guard so route remounts (back to dashboard) don't re-fetch.
let inFlight: Promise<void> | null = null;

function nowStamp() {
  const d = new Date();
  return `${d.getUTCHours().toString().padStart(2, "0")}${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}Z`;
}

function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.length > 4)
    .slice(0, 3);
}

const FALLBACK: string[] = [
  "INTEL OFFLINE // CONNECT GEMINI CORE IN SETTINGS TO RECEIVE LIVE BRIEFINGS.",
  "GLOBAL FEED STANDING BY // FALLBACK MODE.",
  "AWAITING UPLINK // NO ACTIVE INTELLIGENCE STREAM.",
];

export function GlobalIntelFeed({ index = 0 }: { index?: number }) {
  const [items, setItems] = useState<Dispatch[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) return JSON.parse(cached) as Dispatch[];
    } catch {
      /* ignore */
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const ranRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight) return inFlight;
    setLoading(true);
    inFlight = (async () => {
    try {
      const lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      const reply = await askJarvis({
        prompt:
          `You are an intelligence officer. Return the THREE most significant real-world ` +
          `news events you are aware of (geopolitics, conflict, markets, science, technology). ` +
          `Write in the user's language (${lang}). ` +
          `Format each as a terse military dispatch, max 110 characters, ALL CAPS, no markdown. ` +
          `Return them inside the JSON "speech" field, separated by literal newline characters. ` +
          `Set "action" to "none".`,
        fallbackKind: "generic",
      });
      const lines = parseLines(reply.speech || "");
      const finalLines = lines.length ? lines : FALLBACK;
      const stamp = nowStamp();
      const dispatches: Dispatch[] = finalLines.map((text, i) => ({
        id: `${Date.now()}-${i}`,
        time: stamp,
        text,
      }));
      setItems(dispatches);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dispatches));
        window.localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false);
    }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }, []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    // Auto-fetch on mount only if we have a key AND cache is stale.
    const ts = Number(
      (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_TS_KEY)) || 0,
    );
    const stale = Date.now() - ts > MIN_REFRESH_MS;
    if (hasGeminiKey() && stale) void refresh();
    else if (!hasGeminiKey() && items.length === 0) {
      const stamp = nowStamp();
      setItems(FALLBACK.map((t, i) => ({ id: `fb-${i}`, time: stamp, text: t })));
    }
    const id = setInterval(() => {
      if (hasGeminiKey()) void refresh();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  return (
    <HudPanel
      index={index}
      title="GLOBAL INTELLIGENCE FEED"
      rightSlot={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 border border-primary/40 bg-primary/5 px-2 py-1 font-display text-[9px] uppercase tracking-[0.25em] text-primary transition hover:bg-primary/15 disabled:opacity-50"
          aria-label="Refresh intelligence feed"
        >
          <RefreshCw
            className={"h-3 w-3 " + (loading ? "animate-spin" : "")}
            strokeWidth={1.5}
          />
          <span>{loading ? "SYNC" : "REFRESH"}</span>
        </button>
      }
      className="flex flex-col"
    >
      <div className="relative p-3 landscape:max-md:p-2">
        {items.length === 0 ? (
          <p className="font-display text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            ▸ AWAITING UPLINK…
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li
                key={it.id}
                className="flex gap-3 border-l-2 border-primary/50 pl-2 font-mono text-[11px] uppercase leading-snug text-foreground/85 landscape:max-md:text-[9px]"
                style={{ animation: `fade-up 0.45s ease-out ${i * 80}ms both` }}
              >
                <span className="shrink-0 text-primary/80">[{it.time}]</span>
                <span className="truncate-2">{it.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}